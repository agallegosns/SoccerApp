# football-data.org (opcional, NO activado)

La interfaz `MatchProvider` (`src/data/types.ts`) permite añadir otro origen de partidos sin tocar la interfaz de usuario. football-data.org ofrece
una **clave gratuita** (registro en <https://www.football-data.org/client/register>); aquí se documenta cómo se enchufaría. **No está activado**
porque no hay clave y porque ese servicio no es accesible desde el entorno de desarrollo, así que no se ha podido probar.

## Qué hay que implementar
```ts
// src/data/footballDataOrg.ts (ejemplo; no existe en el repositorio)
import { fetchTextWithRetry } from './fetchWithRetry.ts';
import { parseFootballDataOrg } from './parsers.ts';          // ya existe y está probado con datos de ejemplo
import type { League, LoadOptions, Match, MatchProvider } from './types.ts';

const LEAGUES: League[] = [{ id: 'fdo:CL:2026', providerId: 'footballdata', name: 'Champions League', country: 'Europa', season: '2026-27',
  timeNote: 'Horas en UTC; se muestran en tu zona horaria.' }];

export class FootballDataProvider implements MatchProvider {
  readonly id = 'footballdata';
  readonly label = 'football-data.org';
  constructor(private readonly apiKey: string) {}
  listLeagues() { return LEAGUES; }
  async loadMatches(leagueId: string, { signal }: LoadOptions = {}): Promise<readonly Match[]> {
    // La clave viaja en la cabecera X-Auth-Token. fetchTextWithRetry no admite cabeceras todavía: habría que ampliarlo.
    const text = await fetch('https://api.football-data.org/v4/competitions/CL/matches?season=2026', { headers: { 'X-Auth-Token': this.apiKey }, signal }).then((r) => r.text());
    return parseFootballDataOrg(JSON.parse(text), { leagueId, competition: 'Champions League 2026-27' });
  }
}
```
Después se registraría en `createServices()` (`src/data/registry.ts`): `new MatchService([new OpenFootballProvider(), new BundledProvider(), new FootballDataProvider(key), imported], …)`.

## Cómo se configuraría la clave
- La clave **nunca** se versiona. Se pediría al usuario en un ajuste de la app y se guardaría sólo en su `localStorage` (como los calendarios importados).
- Como la app es 100 % cliente, cualquier clave que use es visible para quien use la app; la clave gratuita no cuesta dinero, pero tiene límite de peticiones.

## Cosas que NO están verificadas
- Que la API responda con CORS abierto a un navegador desde otro origen.
- Qué competiciones incluye el plan gratuito (la Champions y las grandes ligas sí figuran en su documentación; la Europa League y la Conference League no está
  confirmado) ni el límite exacto de peticiones por minuto.
- El formato real de las respuestas: `parseFootballDataOrg` se escribió según la documentación y se probó con datos de ejemplo.

Mientras tanto, la forma soportada de usar sus datos es **descargar el JSON** (con `curl` y la cabecera `X-Auth-Token`) y usar *Importar calendario* en la app.
