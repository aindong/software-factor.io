// The suite can itself run inside a factory run, as this project's verify gate. The factory's own
// variables from that outer run must not reach the commands the tests start.
for (const name of Object.keys(process.env)) if (name.startsWith("FACTOR_")) delete process.env[name];
