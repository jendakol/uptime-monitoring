import {api as PagerDuty} from "@pagerduty/pdjs";
import * as firebase from "firebase-admin"
import axios from "axios";
import {none, Option, some} from 'fp-ts/Option'
import {left, right} from "fp-ts/Either";
import assert = require("assert");

const StatsdClient = require('statsd-client')

firebase.initializeApp({
    credential: firebase.credential.applicationDefault()
});

const firestore = firebase.firestore();
const pagerDuty = PagerDuty({token: process.env.PAGERDUTY_TOKEN});

interface EndpointConfig {
    url: string,
    serverName: string,
    serviceReference: string,
    existingIncidentId: Option<string>
}

// TODO optional pagerduty alert
// TODO number of consequent failures

const converter = () => ({
    toFirestore: (data: Partial<EndpointConfig>) => data,
    fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = snap.data() as EndpointConfig
        if (data.existingIncidentId === undefined) data.existingIncidentId = none
        return data
    }
})

export async function checkEndpoints() {
    assert(process.env.PAGERDUTY_TOKEN !== undefined)
    assert(process.env.PAGERDUTY_FROM_HEADER !== undefined)
    assert(process.env.STATSD_HOST !== undefined)
    assert(process.env.STATSD_PREFIX !== undefined)

    const docs = await firestore.collection("endpointConfigs").listDocuments()

    for (const doc of docs) {
        const resp = await checkEndpoint(doc.id)
        console.log(resp)
    }

    return right("ok")
}

async function checkEndpoint(serverhandle: string) {
    const start = new Date()

    const statsdClient = new StatsdClient({host: process.env.STATSD_HOST, prefix: process.env.STATSD_PREFIX + "." + serverhandle});

    try {
        const docRef = firestore.collection('endpointConfigs').doc(serverhandle).withConverter(converter());
        const endpointConfig = await docRef.get().then((d) => d.data())
        if (endpointConfig === undefined) {
            console.log(`Could not find configuration for handle '${serverhandle}'`)
            return left("handle not found");
        }

        console.log(`Going to test URL '${endpointConfig.url}'`)

        try {
            await axios.get(endpointConfig.url, {timeout: 2000})
            // OK!
            statsdClient.increment('successes')

            switch (endpointConfig.existingIncidentId._tag) {
                case 'None' :
                    console.log(`Endpoint '${endpointConfig.url}' OK!`)
                    return right("endpoint ok")
                case 'Some':
                    // ok, we already have an incident to resolve...
                    console.log("About to recover from incident!")
                    return resolveIncidentAndUpdate(endpointConfig.existingIncidentId.value, endpointConfig, statsdClient, docRef)
            }
        } catch (e) {
            console.log("The endpoint is down!")
            statsdClient.increment('failures')

            // oops, let's create the incident
            switch (endpointConfig.existingIncidentId._tag) {
                case 'None' :
                    return createIncidentAndUpdate(endpointConfig, statsdClient, docRef);
                case 'Some':
                    // ok, we already have the incident...
                    return right("incident already exists")
            }
        }
    } finally {
        statsdClient.timing('run', start)
    }
}

async function createIncidentAndUpdate(endpointConfig: EndpointConfig, statsdClient: any, docRef: FirebaseFirestore.DocumentReference<EndpointConfig>) {
    const newId = await createIncident(endpointConfig, statsdClient)

    console.log(`Created new incident with ID '${newId}'`)

    endpointConfig.existingIncidentId = some(newId)
    try {
        await docRef.set(endpointConfig)
        return right("incident created")
    } catch (e) {
        console.log("Couldn't update config in DB!")
        console.log(e)
        return left("incident created, db update failed")
    }
}

async function createIncident(endpointConfig: EndpointConfig, statsdClient: any) {
    const id = makeId(20)

    const resp = await pagerDuty({
        method: 'post',
        endpoint: '/incidents',
        headers: {'From': process.env.PAGERDUTY_FROM_HEADER as string},
        data: {
            incident: {
                type: "incident",
                incident_key: id,
                title: endpointConfig.serverName + " is not available",
                body: {
                    type: "incident_body",
                    details: "Server " + endpointConfig.serverName + " is not available. Check it & fix it."
                },
                service: {
                    type: "service_reference",
                    id: endpointConfig.serviceReference
                }
            }
        }
    })

    if (resp.status === 201) {
        console.log("Incident created!")
        statsdClient.increment('incidents.created')

        return resp.data.incident.id
    } else {
        console.log("Could not create incident:")
        console.log(resp)
        throw new Error(resp.data)
    }
}

async function resolveIncidentAndUpdate(id: string, endpointConfig: EndpointConfig, statsdClient: any, docRef: FirebaseFirestore.DocumentReference<EndpointConfig>) {
    endpointConfig.existingIncidentId = none
    try {
        await resolveIncident(id, statsdClient)
        await docRef.set(endpointConfig)
        return right("incident resolved")
    } catch (e) {
        console.log(e)
        return left("incident resolved, db update failed")
    }
}

async function resolveIncident(id: string, statsdClient: any) {
    const resp = await pagerDuty({
        method: 'put',
        endpoint: '/incidents',
        headers: {'From': process.env.PAGERDUTY_FROM_HEADER as string},
        data: {
            incidents: [{
                type: "incident_reference",
                id: id,
                status: "resolved"
            }]
        }
    })

    if (resp.status === 200) {
        console.log("Incident resolved!")
        statsdClient.increment('incidents.resolved')
        return
    } else {
        console.log("Could not resolve incident:")
        console.log(resp)
        throw new Error(resp.data)
    }
}

function makeId(length: number) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}
