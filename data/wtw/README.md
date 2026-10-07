# Where's the Water data

`river-sections-sca-copy.json` and `scheduled-sections-sca-copy.json` are unmodified copies of the
data files from [Where's the Water](https://www.andyjacksonfund.org.uk/wheres-the-water/)
([source](https://github.com/jriddell/wheres-the-water/tree/master/data)),
Copyright Scottish Canoe Association, maintained by Jonathan Riddell and contributors, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

`../wtw-import.json` is River Guide's adaptation of that data: matches to River Guide sections, paddler
level bands, new sections and release dates. It is licensed under CC BY-SA 4.0 as well.
Regenerate it with `npm run data:wtw` (add `-- --latest` to pull their newest data instead of the pinned commit).
