# QAIORA – geschützte Cloudflare-Testversion

Dieses Projekt ist eine separate Testbereitstellung. Es verändert weder die bestehende GitHub-Pages-Seite noch die Domain `qaiora.com`.

## Architektur
- Cloudflare Worker schützt alle App-Dateien; nur `/login` und die Auth-Endpunkte sind öffentlich.
- Supabase Auth übernimmt Registrierung, E-Mail-Bestätigung und Anmeldung.
- Der Worker validiert das Supabase-Access-Token serverseitig und stellt danach ein signiertes, HttpOnly-Cookie mit 1 Stunde Laufzeit aus.
- `SESSION_SECRET` muss als Cloudflare Secret gesetzt werden. Niemals in Git committen.
- Das Supabase Publishable Key ist für Browser-/Clientnutzung vorgesehen und kein Service-Role-Key.

## Vor dem ersten Deployment
1. In Supabase unter Authentication → URL Configuration die spätere `workers.dev`-Adresse als Redirect URL zulassen, z. B. `https://<worker-subdomain>.workers.dev/login`.
2. In Cloudflare `SESSION_SECRET` als Secret setzen (zufälliger Wert mit mindestens 32 Bytes).
3. Erst danach den Worker deployen und Registrierung, E-Mail-Bestätigung, Login, Logout sowie direkten Zugriff auf `/` ohne Anmeldung testen.

## Hinweis zur Session
Das QAIORA-Cookie läuft nach 1 Stunde ab. Die Supabase-Session bleibt im Browser gespeichert; beim erneuten Öffnen der Login-Seite kann sie wieder gegen den Worker ausgetauscht werden.

## Sicherheitshinweis
Die Seite wird nur für nicht angemeldete Besucher geschützt. Angemeldete Nutzer können weiterhin den an ihren Browser ausgelieferten HTML-/JavaScript-Code untersuchen. Für den aktuellen QAIORA-Ansatz liegen die Promptvorlagen im Clientcode; wenn diese auch vor angemeldeten Nutzern verborgen bleiben sollen, müssten sie in serverseitige Logik verschoben werden.
