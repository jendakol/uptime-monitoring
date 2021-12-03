import {Request, Response} from 'express'

import {checkEndpoints as functionCheckEndpoints} from './checkEndpoint'

export async function checkEndpoints(_: Request, res: Response) {
    try {
        const resp = await functionCheckEndpoints()

        res.status(200)
        res.send(resp)
    } catch (err) {
        console.log("Fatal failure!")
        console.log(err)
        res.status(500)
        res.send(err)
        return;
    }
}
