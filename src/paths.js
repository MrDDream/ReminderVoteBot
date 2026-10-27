import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let checked = false;

export function ensureDataDir() {
	if (checked) return;
	fs.mkdirSync(dataDir, { recursive: true });
	// Docker images up to Node 20 ran as root: an existing volume may still belong to root.
	const notWritable = [dataDir, ...fs.readdirSync(dataDir).map(name => path.join(dataDir, name))]
		.filter(file => {
			try {
				fs.accessSync(file, fs.constants.W_OK);
				return false;
			} catch {
				return true;
			}
		});
	if (notWritable.length > 0) {
		throw new Error(`Données non modifiables par l'utilisateur ${process.getuid?.() ?? ''} : ${notWritable.join(', ')}. `
			+ 'Avec Docker, lancez une fois : docker compose run --rm --user root bot chown -R node:node /app/data');
	}
	checked = true;
}
