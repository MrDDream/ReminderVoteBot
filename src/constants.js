// Values shared by the bot and the slash command deployment script.

export const COOLDOWN_CHOICES = [
	{ minutes: 60, fr: '1 heure', en: '1 hour' },
	{ minutes: 120, fr: '2 heures', en: '2 hours' },
	{ minutes: 180, fr: '3 heures', en: '3 hours' },
	{ minutes: 240, fr: '4 heures', en: '4 hours' },
	{ minutes: 720, fr: '12 heures', en: '12 hours' },
	{ minutes: 1440, fr: '24 heures', en: '24 hours' }
];

export const DEFAULT_COOLDOWN_MINUTES = 120;

export const BOT_LANG = (process.env.BOT_LANG || 'fr').trim().toLowerCase() === 'en' ? 'en' : 'fr';
