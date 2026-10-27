// Loads .env from the working directory when present.
// Variables already set in the environment (e.g. by Docker) take precedence.
try {
	process.loadEnvFile();
} catch (err) {
	if (err.code !== 'ENOENT') throw err;
}
