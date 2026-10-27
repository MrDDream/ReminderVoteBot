import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function ensureDataDir() {
	fs.mkdirSync(dataDir, { recursive: true });
}
