// About: what the site is, how statuses work, data sources and licences.

import { statusPill } from '../components.ts';
import { h } from '../dom.ts';
import type { AppCtx, Page } from '../main.ts';

const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

export function mountAbout(container: HTMLElement, ctx: AppCtx): Page {
  ctx.setTitle('About');
  container.append(
    h(
      'article',
      { class: 'wrap prose about' },
      h('h1', null, 'About River Guide'),
      h(
        'p',
        { class: 'lede' },
        'River Guide shows which Scottish whitewater sections are likely to be running, using live SEPA river gauges, the weather forecast and level advice from the paddling guidebooks.',
      ),
      h('p', null, 'It is a planning aid for deciding where to look, not a substitute for looking. Levels and estimates can be wrong, and hazards such as trees, landslips and works change without notice. You are responsible for your own safety.'),

      h('h2', null, 'How statuses work'),
      h('p', null, 'Each section is linked to one or more SEPA gauges. Where we have a paddling band for a gauge (a level it runs from, and a level where it gets too high), the current reading puts the section into one of four states:'),
      h(
        'ul',
        { class: 'status-key' },
        h('li', null, statusPill('runnable'), ' The gauge is inside the paddling band.'),
        h('li', null, statusPill('low'), ' Below the level the section runs from.'),
        h('li', null, statusPill('high'), ' Above the level where it becomes too high, for its usual grade or at all.'),
        h('li', null, statusPill('unknown'), ' No band for this gauge, no gauge, or the reading is more than three hours old.'),
      ),
      h('p', null, 'Bands come from three places, and each river page says which:'),
      h(
        'dl',
        { class: 'basis-list' },
        h('dt', null, 'Estimated from the guidebook'),
        h('dd', null, "Worked out from the guidebook's water level notes. Marked ", h('abbr', { class: 'est', title: 'Thresholds estimated from guidebook descriptions' }, 'est.'), ' in the list. Each estimate carries a confidence rating (high, medium or low) for how directly the guide supports it.'),
        h('dt', null, 'Matched to how often the gauge reaches each level'),
        h(
          'dd',
          null,
          'Most sections. Where the guide only says "after heavy rain" or "needs a spate", that wording is matched to how often the gauge reaches each level, from three years of SEPA daily maximum readings. For example, "needs a spate" might mean a level reached on about 10% of days. Each river page also shows how often the current level is reached.',
        ),
        h('dt', null, 'Based on SEPA typical range'),
        h('dd', null, "For the few gauges without enough history: thresholds are placed within the gauge's typical range (between its median annual low and high)."),
        h('dt', null, 'Set manually'),
        h('dd', null, 'Set by hand for this section. Manual bands take priority over estimates.'),
      ),
      h('p', null, 'Rising, falling and steady compare the latest reading with the one an hour earlier.'),

      h('h2', null, 'Data sources and licences'),
      h(
        'ul',
        { class: 'sources' },
        h('li', null, h('strong', null, 'River levels: '), ext('https://www.sepa.org.uk/environment/water/water-levels/', 'SEPA'), ' river level data, used under the ', ext('https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', 'Open Government Licence v3.0'), '. Contains SEPA data © Scottish Environment Protection Agency and database right.'),
        h('li', null, h('strong', null, 'Weather: '), ext('https://open-meteo.com/', 'Open-Meteo'), ', licensed under ', ext('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'), '.'),
        h('li', null, h('strong', null, 'Maps: '), '© ', ext('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), ', data available under the Open Database Licence (ODbL).'),
        h('li', null, h('strong', null, 'River sections: '), 'section names, grades and level advice are derived from ', ext('https://www.ukriversguidebook.co.uk/', 'UK Rivers Guidebook'), '. The full write-ups, with hazards, access and route details, live there. Please read them, and contribute updates when things change.'),
      ),

      h('h2', null, 'The chat assistant'),
      h('p', null, "Ask River Guide answers questions using the same gauges, bands and forecasts as the rest of the site. It can be wrong. Treat its answers as a starting point and check the river page and the guidebook before you go."),
    ),
  );
  return {};
}
