import {Request, Response} from 'express'

import {checkEndpoint} from './checkEndpoint'

export async function checkEndpoints(_: Request, res: Response) {
    const handles = ["cloud", "grafana"]

    try {
        for (const handle of handles) {
            const resp = await checkEndpoint(handle)
            console.log(resp)
        }
    } catch (err) {
        res.status(500)
        res.send(err)
        return;
    }

    res.status(200)
    res.send("ok")
}
