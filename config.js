/*
 * Einstellungen der Annahme-Seite. Hier steht kein Geheimnis: Die Adresse der Server-Funktion ist öffentlich (sie liefert nur zu einem
 * gültigen Geheimcode im Link etwas aus). Den Geheimcode kennt nur, wer den Link bekommen hat – er steht hinter dem "#" und wird
 * nie an den Server dieser Seite geschickt.
 *
 *   funktionsUrl   Adresse der Server-Funktion "pz-angebot-freigabe" deines Supabase-Projekts
 *                  (https://<projekt>.supabase.co/functions/v1/pz-angebot-freigabe)
 *   impressumUrl   Link zu deinem Impressum (leer lassen, wenn es keins gibt – siehe docs/bedienung/angebot-online.md)
 *   datenschutzUrl Link zu deiner Datenschutzerklärung (leer lassen, wenn es keine gibt)
 */
window.PZ_ANGEBOT = {
  funktionsUrl: 'https://uycyempsfxwfngyhhqjv.supabase.co/functions/v1/pz-angebot-freigabe',
  impressumUrl: '',
  datenschutzUrl: '',
};
