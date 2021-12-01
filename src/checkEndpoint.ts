import axios from 'axios';
import {none, Option, some} from 'fp-ts/Option'
import {api} from "@pagerduty/pdjs";
import * as admin from "firebase-admin"
import {left, right} from "fp-ts/Either";

admin.initializeApp({
    credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const pd = api({token: 'e+NqeQedDk5bUeZ_sPXA'});

interface EndpointConfig {
    url: string,
    serverName: string,
    existingIncidentId: Option<string>
}

const converter = () => ({
    toFirestore: (data: Partial<EndpointConfig>) => data,
    fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = snap.data() as EndpointConfig
        if (data.existingIncidentId === undefined) data.existingIncidentId = none
        return data
    }
})

export async function checkEndpoint(serverhandle: string) {
    // TODO send ticks to graphite

    const docRef = db.collection('endpointConfigs').doc(serverhandle).withConverter(converter());
    const endpointConfig = await docRef.get().then((d) => d.data())
    if (endpointConfig === undefined) {
        console.log(`Could not find configuration for handle '${serverhandle}'`)
        return left("handle not found");
    }

    console.log(`Going to test URL '${endpointConfig.url}'`)

    try {
        await axios.get(endpointConfig.url, {timeout: 2000})
        // OK!
        switch (endpointConfig.existingIncidentId._tag) {
            case 'None' :
                // ok!
                return right("endpoint ok")
            case 'Some':
                // ok, we already have an incident to resolve...
                console.log("About to recover from incident!")
                return resolveIncidentAndUpdate(endpointConfig.existingIncidentId.value, endpointConfig, docRef)
        }
    } catch (e) {
        console.log("The endpoint is down!")

        // oops, let's create the incident
        switch (endpointConfig.existingIncidentId._tag) {
            case 'None' :
                return createIncidentAndUpdate(endpointConfig, docRef);
            case 'Some':
                // ok, we already have the incident...
                return right("incident already exists")
        }
    }
}

async function createIncidentAndUpdate(endpointConfig: EndpointConfig, docRef: FirebaseFirestore.DocumentReference<EndpointConfig>) {
    const newId = await createIncident(endpointConfig.serverName)

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

async function createIncident(serverName: string) {
    const id = makeId(20)

    const resp = await pd({
        method: 'post',
        endpoint: '/incidents',
        headers: {'From': "jendakolena@gmail.com"},
        data: {
            incident: {
                type: "incident",
                incident_key: id,
                title: serverName + " is not available",
                body: {
                    type: "incident_body",
                    details: "Server " + serverName + " is not available. Check it & fix it."
                },
                service: {
                    type: "service_reference",
                    id: "PZW4R7U"
                }
            }
        }
    })

    if (resp.status === 201) {
        console.log("Incident created!")

        return resp.data.incident.id
    } else {
        console.log("Could not create incident:")
        console.log(resp)
        throw new Error(resp.data)
    }
}

async function resolveIncidentAndUpdate(id: string, endpointConfig: EndpointConfig, docRef: FirebaseFirestore.DocumentReference<EndpointConfig>) {
    endpointConfig.existingIncidentId = none
    try {
        await resolveIncident(id)
        await docRef.set(endpointConfig)
        return right("incident resolved")
    } catch (e) {
        console.log(e)
        return left("incident resolved, db update failed")
    }
}

async function resolveIncident(id: string) {
    const resp = await pd({
        method: 'put',
        endpoint: '/incidents',
        headers: {'From': "jendakolena@gmail.com"},
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
