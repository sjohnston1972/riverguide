// About: what the site is, how statuses work, data sources and licences.

import { statusPill } from '../components.ts';
import { h } from '../dom.ts';
import type { AppCtx, Page } from '../main.ts';

const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const WTW = () => ext('https://www.andyjacksonfund.org.uk/wheres-the-water/', "Where's the Water");

export function mountAbout(container: HTMLElement, ctx: AppCtx): Page {
  ctx.setTitle('About');

  // Only describe the chat assistant while it is switched on.
  const chat = h(
    'section',
    { hidden: !ctx.config()?.chat_enabled },
    h('h2', null, 'The chat assistant'),
    h('p', null, 'Ask River Guide answers questions using the same gauges, levels and forecasts as the rest of the site. It can be wrong. Treat its answers as a starting point and check the river page and a current guidebook before you go.'),
  );
  const onConfig = () => (chat.hidden = !ctx.config()?.chat_enabled);
  document.addEventListener('rg:config', onConfig);

  container.append(
    h(
      'article',
      { class: 'wrap prose about' },
      h('h1', null, 'About River Guide'),
      h(
        'p',
        { class: 'lede' },
        'River Guide shows which Scottish whitewater sections are likely to be running. It combines live SEPA river gauges, levels set by paddlers, reports from people who have just paddled, scheduled dam releases and the weather forecast.',
      ),
      h('p', null, 'It is a planning aid for deciding where to look, not a substitute for looking. Levels and estimates can be wrong, and hazards such as trees, landslips and works change without notice. River Guide does not cover hazards, access or route details: check a current guidebook and local knowledge before you paddle. You are responsible for your own safety.'),

      h('h2', null, 'How statuses work'),
      h('p', null, 'Each section is linked to one or more SEPA gauges. Where a gauge has a paddling band (a level the section runs from, and a level where it gets too high), the latest reading puts the section into one of four states:'),
      h(
        'ul',
        { class: 'status-key' },
        h('li', null, statusPill('runnable'), ' The gauge is inside the paddling band.'),
        h('li', null, statusPill('low'), ' Below the level the section runs from.'),
        h('li', null, statusPill('high'), ' Above the level where it becomes too high, for its usual grade or at all.'),
        h('li', null, statusPill('unknown'), ' No band for this gauge, no gauge, or the reading is more than three hours old.'),
      ),
      h('p', null, 'Rising, falling and steady are SEPA’s own indicator for the gauge, or, when that isn’t current, the change since an hour earlier. River pages also show how often the current level is reached, from three years of SEPA readings.'),

      h('h2', null, 'Where the paddling bands come from'),
      h('p', null, 'Every river page says where its band came from. When a section has more than one, the first in this list wins:'),
      h(
        'dl',
        { class: 'basis-list' },
        h('dt', null, '1. Set manually'),
        h('dd', null, 'Set by hand for a section from local knowledge.'),
        h('dt', null, '2. Community reports'),
        h(
          'dd',
          null,
          'Paddlers report how a section was (too low, scrapy, good, pushy or too high), and the gauge level at that time is recorded. Once a section has at least 5 reports from 3 people on 2 different days, its band is set where the reports change from too low to runnable and from runnable to too high. Marked ',
          h('abbr', { class: 'est est-community', title: 'Thresholds set from community paddling reports' }, 'community'),
          ' in the list.',
        ),
        h('dt', null, "3. Paddler levels from Where's the Water"),
        h(
          'dd',
          null,
          'About 110 sections use levels that paddlers have set on ',
          WTW(),
          ': scrapeable, low, medium, high, very high and huge, each a level on a SEPA gauge. The list and river pages show which step a river is on now (for example "Medium"). Runnable means scrapeable or above, and too high means huge.',
        ),
        h('dt', null, '4. Estimated from guidebook descriptions'),
        h(
          'dd',
          null,
          'Everything else is an estimate, marked ',
          h('abbr', { class: 'est', title: 'Thresholds estimated from guidebook descriptions' }, 'est.'),
          ' in the list, with a confidence rating (high, medium or low). Where the guidebook gives levels in metres, those are used. Where it only says "after heavy rain" or "needs a spate", the wording is matched to how often the gauge reaches each level: "needs a spate" might mean a level reached on about 10% of days. For the few gauges without enough history, the band is placed within the gauge\'s typical range instead.',
        ),
      ),

      h('h2', null, 'Level outlook'),
      h(
        'p',
        null,
        "For about 110 gauges, river pages show where the level is likely to be tomorrow and the day after, with a likely range. It is worked out from that gauge's own history: on the most similar past days (similar level, similar rain that day and the next), how much did the river change? It uses the rain forecast for the gauge's location.",
      ),
      h(
        'p',
        null,
        'Each gauge was tested on every season of the last three years, a block at a time, on days the model had not seen. Only gauges where it clearly beat "tomorrow will be the same as today", and did no worse on wet days, get a prediction. Other gauges show just a direction (likely to rise, drop or stay about the same) from the current trend and the rain due. Those tests used the rain that actually fell, so a wrong rain forecast makes the prediction wrong too. Treat all of it as a rough guide: rain falling higher up a catchment may not be in the forecast for the gauge.',
      ),

      h('h2', null, 'Dam releases and the Falls of Lora'),
      h(
        'p',
        null,
        'Some rivers run on hydro dam releases rather than rain. ',
        h('a', { href: '/releases' }, 'Dam releases'),
        ' lists every release in SSE’s freshet schedule, which SEPA publishes each year, with its start and end time and its size. Size is the release volume divided by its duration, so it is the average flow the release adds to the river (for the upper Tummel it includes the compensation flow). The schedule is checked daily. Releases can change or be cancelled, so check before travelling.',
      ),
      h(
        'p',
        null,
        'The ',
        h('a', { href: '/falls-of-lora' }, 'Falls of Lora'),
        ' run on the tide. River Guide predicts the tide at Oban from three years of SEPA’s Oban tide gauge readings (a harmonic tide model), then applies the ebb timings from ',
        ext('https://www.fallsoflora.info/', 'fallsoflora.info'),
        '. Ranges are scaled to match published tide tables, so "over 3.2 m" means the same as in a tide table. Tested on 90 days the model had not seen, predicted high and low water times were within 10 minutes half the time and within 30 minutes nine times in ten. Weather can raise or lower the tide by up to half a metre. Not for navigation.',
      ),

      h('h2', null, 'Community reports'),
      h(
        'p',
        null,
        'Reports are anonymous and public. A quick automated check runs the first time you report or vote from a device. Each report asks "Agree with this?": agreeing adds weight to it, and reports that more people disagree with than agree with, from 3 or more people, stop counting. Each device can make one report per section per day.',
      ),
      h(
        'p',
        null,
        "Keep notes to river conditions. Notes that several people report as inappropriate are hidden, and reports can be removed by the site's maintainer. Don't post personal information.",
      ),

      h('h2', null, 'Favourites'),
      h(
        'p',
        null,
        'Tap the star on a river to add it to your favourites, then use the Favourites filter on the river list or map. Favourites are saved in this browser on this device only: they are not sent to River Guide, and they won’t follow you to another phone or computer.',
      ),

      chat,

      h('h2', null, 'Data sources and licences'),
      h(
        'ul',
        { class: 'sources' },
        h('li', null, h('strong', null, 'Dam releases: '), 'SSE’s freshet schedule, as published by ', ext('https://beta.sepa.scot/topics/water/water-levels/hydropower-scheme-water-releases/', 'SEPA'), '. Tide predictions are fitted to SEPA’s Oban tide gauge.'),
        h('li', null, h('strong', null, 'River levels: '), ext('https://www.sepa.org.uk/environment/water/water-levels/', 'SEPA'), ' river level data, used under the ', ext('https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', 'Open Government Licence v3.0'), '. Contains SEPA data © Scottish Environment Protection Agency and database right.'),
        h(
          'li',
          null,
          h('strong', null, 'Paddler levels, extra sections and backup release dates: '),
          WTW(),
          ' (Copyright Scottish Canoe Association; data maintained by Jonathan Riddell and contributors), used under ',
          ext('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0'),
          '. River Guide adapts it: sections are matched to ours, levels are mapped onto our statuses, and some data is left out. Our adapted copy is shared under the same licence in the ',
          ext('https://github.com/sjohnston1972/riverguide/tree/main/data', 'River Guide repository'),
          ' (data/wtw-import.json).',
        ),
        h('li', null, h('strong', null, 'Other section details: '), 'section names, grades and level descriptions are compiled from paddling guidebook information.'),
        h('li', null, h('strong', null, 'Weather: '), ext('https://open-meteo.com/', 'Open-Meteo'), ', licensed under ', ext('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'), '.'),
        h('li', null, h('strong', null, 'Maps: '), '© ', ext('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), ', data available under the Open Database Licence (ODbL).'),
      ),
    ),
  );
  return {
    destroy() {
      document.removeEventListener('rg:config', onConfig);
    },
  };
}
