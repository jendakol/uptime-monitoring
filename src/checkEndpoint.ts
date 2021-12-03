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

const ConfigCollectionName = "endpointConfigs"

interface EndpointConfig {
    url: string,
    serverName: string,
    serviceReference: Option<string>,
    consequentFailuresThreshold: number,
    consequentFailuresCurrent: number,
    existingIncidentId: Option<string>
}

const converter = () => ({
    toFirestore: (data: Partial<EndpointConfig>) => data,
    fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = snap.data() as EndpointConfig
        if (data.serviceReference === undefined) data.serviceReference = none
        if (data.existingIncidentId === undefined) data.existingIncidentId = none
        return data
    }
})

export async function checkEndpoints() {
    console.log("Checking all ENVs")

    assert(process.env.PAGERDUTY_TOKEN !== undefined)
    assert(process.env.PAGERDUTY_FROM_HEADER !== undefined)
    assert(process.env.STATSD_HOST !== undefined)
    assert(process.env.STATSD_PREFIX !== undefined)

    const docs = await firestore.collection(ConfigCollectionName).listDocuments()

    for (const doc of docs) {
        console.log(`Checking '${doc.id}'`)
        const resp = await checkEndpoint(doc.id)
        console.log(resp)
    }

    return right("ok")
}

export async function checkEndpoint(serverhandle: string) {
    const start = new Date()

    const statsdClient = new StatsdClient({host: process.env.STATSD_HOST, prefix: process.env.STATSD_PREFIX + "." + serverhandle});

    try {
        const docRef = firestore.collection(ConfigCollectionName).doc(serverhandle).withConverter(converter());
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

            return resolveIncidentIfAny(endpointConfig, statsdClient, docRef)
        } catch (e) {
            console.log("The endpoint is down!")
            statsdClient.increment('failures')

            endpointConfig.consequentFailuresCurrent++;

            if (endpointConfig.consequentFailuresCurrent >= endpointConfig.consequentFailuresThreshold) {
                // oops, let's create the incident
                return createIncidentIfConfiguredAndUpdate(endpointConfig, statsdClient, docRef)
            } else {
                // just update the current failures count
                try {
                    await docRef.set(endpointConfig)
                    return right("not enough consequent failures")
                } catch (e) {
                    console.log("Couldn't update config in DB!")
                    console.log(e)
                    return left("not enough consequent failures, couldn't save config to DB")
                }
            }
        }
    } finally {
        statsdClient.timing('run', start)
    }
}

async function createIncidentIfConfiguredAndUpdate(endpointConfig: EndpointConfig, statsdClient: any, docRef: FirebaseFirestore.DocumentReference<EndpointConfig>) {
    switch (endpointConfig.serviceReference?._tag) {
        case 'Some':
            switch (endpointConfig.existingIncidentId._tag) {
                case 'None' :
                    return createIncidentAndUpdate(endpointConfig, statsdClient, docRef)
                case 'Some':
                    // ok, we already have the incident...

                    try {
                        await docRef.set(endpointConfig)
                        return right("incident already exists")
                    } catch (e) {
                        console.log("Couldn't update config in DB!")
                        console.log(e)
                        return left("incident already exists, couldn't save config to DB")
                    }
            }
            break;

        case 'None':
            try {
                await docRef.set(endpointConfig)
                return right("incidents not configured")
            } catch (e) {
                console.log("Couldn't update config in DB!")
                console.log(e)
                return left("incidents not configured, couldn't save config to DB")
            }
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

async function resolveIncidentIfAny(endpointConfig: EndpointConfig, statsdClient: any, docRef: FirebaseFirestore.DocumentReference<EndpointConfig>) {
    switch (endpointConfig.serviceReference?._tag) {
        case 'Some':
            switch (endpointConfig.existingIncidentId._tag) {
                case 'None' :
                case undefined:
                    // just update db
                    console.log(`Endpoint '${endpointConfig.url}' OK!`)
                    endpointConfig.consequentFailuresCurrent = 0

                    try {
                        await docRef.set(endpointConfig)
                        return right("endpoint ok")
                    } catch (e) {
                        console.log(e)
                        return left("endpoint ok, db update failed")
                    }

                case 'Some':
                    // ok, we already have an incident to resolve...
                    console.log("About to recover from incident!")
                    return resolveIncidentAndUpdate(endpointConfig.existingIncidentId.value, endpointConfig, statsdClient, docRef)
            }
            break;

        case 'None':
        case undefined:
            if (endpointConfig.consequentFailuresCurrent !== 0) {
                endpointConfig.consequentFailuresCurrent = 0

                try {
                    await docRef.set(endpointConfig)
                    return right("endpoint ok")
                } catch (e) {
                    console.log(e)
                    return left("endpoint ok, db update failed")
                }
            } else {
                // no need to update anything
                return right("endpoint ok")
            }
    }

    console.log("unreachable")
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
