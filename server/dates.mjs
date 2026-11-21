// Dates et heures à l'heure de Paris

// Date du jour (+ offset en jours) au format AAAA-MM-JJ
export function getParisDate(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

export function getParisHour() {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).formatToParts(new Date());
    return Number(parts.find(p => p.type === 'hour').value);
}

// Date AAAA-MM-JJ décalée de n jours
export function decaler(date, jours) {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + jours);
    return d.toISOString().slice(0, 10);
}
