declare global {
  namespace NodeJS {
    interface ProcessEnv {
      STATSD_HOST: string;
      STATSD_PREFIX: string;
      PAGERDUTY_TOKEN: string;
      PAGERDUTY_FROM_HEADER: string;
    }
  }
}

// If this file has no import/export statements (i.e. is a script)
// convert it into a module by adding an empty export statement.
export {}
