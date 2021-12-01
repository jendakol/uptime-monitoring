import {Request, Response} from 'express'

import {checkEndpoint} from './checkEndpoint'

export async function checkEndpoints(_: Request, res: Response) {
    try {
        const resp = await checkEndpoint("cloud")

        switch (resp._tag) {
            case "Right":
                res.status(200)
                break;
            case "Left":
                res.status(500)
                break;
        }

        res.send(resp)
    } catch (err) {
        res.status(500)
        res.send(err)
    }
}
