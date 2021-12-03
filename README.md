# Uptime monitoring

This is a simple solution for monitoring your HTTP endpoints (you can, of course, extend it to check anything...).  
I was using [Uptime Robot](https://uptimerobot.com/) but was not willing to accept their paid plan terms (it was just too expensive for a
guy who runs few family-critical services, without any profit). So I decided to learn TypeScript, wrote this tool and deployed in into the
Google Cloud where it runs as Google Functions, triggered by Cloud Scheduler.

Feel free to contact me, I can provide you my Grafana dashboard for this ;-)

## Dependencies

Installed NPM, `gcloud`. Running StatsD (where metrics will be sent) and [PagerDuty](https://www.pagerduty.com/pricing/) account/services (
optional).

## Development

I run it in Intellij IDEA via [idea-run-typescript](https://github.com/bluelovers/idea-run-typescript) plugin. I have `src/main.ts` where I
do my stuff (it's added to `.gitignore`) and I run it. Don't forget to set all ENVs in the run configuration (see `.env.yaml.example` for
their list).

## Deploy

### Env file

Create your `.env.yaml` (from `.env.yaml.example`) and fill with your values.

### Deploy command

Assuming you have everything set-up, just run:

```bash
npm run deploy -- checkEndpoints --max-instances 1 --region europe-west3 --project GOOGLEPROJECT
```

(don't forget to specify your Google Project ID)
