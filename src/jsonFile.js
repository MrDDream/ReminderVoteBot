import fs from 'fs';

export class CorruptedDataError extends Error {
	constructor(filePath, cause) {
		super(`Fichier de données illisible : ${filePath} (${cause?.message || cause}). `
			+ 'Aucune sauvegarde valide trouvée : réparez ou restaurez ce fichier avant de redémarrer le bot.');
		this.name = 'CorruptedDataError';
		this.filePath = filePath;
	}
}

function parseFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Reads a JSON file. Returns undefined when the file does not exist.
// On a parse error, falls back to the .bak copy written by writeJsonAtomic;
// if that fails too, throws instead of silently returning empty data
// (which would then be saved over the user's real data).
export function readJson(filePath) {
	if (!fs.existsSync(filePath)) return undefined;
	try {
		return parseFile(filePath);
	} catch (err) {
		const backupPath = `${filePath}.bak`;
		const corruptPath = `${filePath}.corrupt-${Date.now()}`;
		try {
			fs.copyFileSync(filePath, corruptPath);
		} catch {
			// ignore
		}
		if (fs.existsSync(backupPath)) {
			try {
				const data = parseFile(backupPath);
				console.warn(`[WARN] ${filePath} illisible (${err.message}), restauration depuis ${backupPath}. Copie du fichier corrompu : ${corruptPath}`);
				fs.copyFileSync(backupPath, filePath);
				return data;
			} catch {
				// fall through
			}
		}
		throw new CorruptedDataError(filePath, err);
	}
}

// Writes to a temp file then renames it, so a crash mid-write never leaves
// a truncated file. The previous version is kept as <file>.bak.
export function writeJsonAtomic(filePath, data) {
	const tmpPath = `${filePath}.tmp`;
	fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
	if (fs.existsSync(filePath)) {
		try {
			fs.copyFileSync(filePath, `${filePath}.bak`);
		} catch {
			// ignore
		}
	}
	fs.renameSync(tmpPath, filePath);
}
