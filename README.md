# Uptime monitoring

## Dependencies

Installed NPM, `gcloud`.

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
