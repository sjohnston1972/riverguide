#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use utf8;
use open ':std', ':encoding(UTF-8)';
use FindBin qw($RealBin);

# Defaults are the JSON files committed in the repo root (next to this
# script). Override with: perl reword_rivers2.pl <input.json> <output.json>
my $input_file  = $ARGV[0] // "$RealBin/scotland_rivers_detail.json";
my $output_file = $ARGV[1] // "$RealBin/scotland_rivers_detail_reworded.json";

my $raw = do {
    local $/;
    open my $fh, '<:utf8', $input_file or die "Cannot open $input_file: $!";
    <$fh>;
};

my $data = JSON::PP->new->utf8(0)->decode($raw);

my @fields_to_rewrite = qw(where_is_it water_level general_description other_notes major_hazards access_hassles);

# ============================================================
# HELPER: remove a whole sentence if it contains a pattern
# ============================================================
sub remove_sentences_matching {
    my ($text, $pattern) = @_;
    # Split on sentence boundaries then filter
    # Process sentence by sentence
    $text =~ s/[^.!?]*$pattern[^.!?]*[.!?]?\s*//gi;
    return $text;
}

# ============================================================
# MAIN REWRITE FUNCTION
# ============================================================
sub rewrite_text {
    my ($text) = @_;
    return $text unless defined $text && $text ne '';

    # ------------------------------------------------------------------
    # STEP 1: Remove entire sentences that are pure personal anecdotes
    #         or community calls-to-action (nothing factual to keep)
    # ------------------------------------------------------------------

    # "we don't have proper rivers up here so we're desperate..."
    $text =~ s/\([Ww]e don.t have proper rivers[^)]*\)//g;
    $text =~ s/[Ww]e don.t have proper rivers[^.]*\.?\s*//g;

    # "good for washing salt and sand off the kit"
    $text =~ s/,?\s*good for washing salt and sand off the kit[^.]*\.?//gi;

    # "why bother? a) It's there b) it seemed like a good idea"
    $text =~ s/[Ww]hy bother\?[^.]*\.?\s*//g;

    # Remove calls to action
    $text =~ s/[^.!?]*let us know what you find[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*let us know how you get on[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*let us know[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*tell us what you find[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*Anyone seen it[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*Anyone paddled[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*if you find something[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*send us photos[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*take pictures if you do[^.!?]*[.!?]?\s*//gi;
    $text =~ s/see how far you can hike and[^.!?]*[.!?]?\s*//gi;
    # Remove "See how many X puns you can come up with" and associated joke lines
    $text =~ s/See how many "[^"]*" puns you can come up with[^.!?]*[.!?]?\s*//gi;
    $text =~ s/"they said it was high[^"]*"[^.!?]*[.!?]?\s*//gi;
    $text =~ s/"It is worth noting to be[^"]*"[^.!?]*[.!?]?\s*//gi;
    $text =~ s/"Can you see a clean[^"]*"[^.!?]*[.!?]?\s*//gi;

    # Remove first-descent credits with names/initials
    $text =~ s/First recorded descent[^.]*\.?\s*//gi;
    $text =~ s/First descent[^.]*(?:J\.[A-Z]\.?\w*|[A-Z][a-z]+ [A-Z][a-z]+)[^.]*\.?\s*//g;

    # Remove photo/paddler credit lines
    $text =~ s/Paddler:\s*[^,.\n]+[,.]?\s*Photo:[^\n.]*[.\n]?//gi;
    $text =~ s/Photo:\s*[^.\n]+[.\n]?//gi;

    # NOTE (issue #9): the three generic "[A-Z][a-z]+ [A-Z][a-z]+ ... 'quoted'"
    # patterns that used to live here were removed. They matched *any* two
    # consecutive capitalised words - in this dataset that is overwhelmingly
    # a place/river name ("Fort William.", "Loch Dughail.", "Power Station.",
    # "South Esk.", ...), not a contributor credit, and they were deleting
    # real geography and even safety-relevant text (e.g. a quoted hazard
    # warning beginning "The North Sannox has a large tree..."). Verified
    # against the real data: across the whole dataset they matched their
    # intended target (a genuine contributor name/quote attribution) in only
    # a handful of cases while corrupting dozens of legitimate fields, so
    # they are not worth keeping in this broad form. Real contributor names
    # are handled by the explicit literal list in STEP 2 instead (this is
    # where "Iain McKendry." - the one genuine target of the old line 86
    # rule - is now removed).

    # Remove "Before I start I should say I am not a paddler"
    $text =~ s/[^.!?]*Before I start I should say[^.!?]*[.!?]?\s*//gi;

    # Remove meta-comments about grading
    $text =~ s/I.m not going to bother putting grades[^.]*\.?\s*//gi;

    # Remove "incidentally, I never found my blades..."
    $text =~ s/[Ii]ncidentally, I never found[^.]*\.?\s*//g;

    # Remove "Can't say I was too bothered at the time!"
    $text =~ s/Can.t say I was too bothered at the time[^.!]*[.!]?\s*//gi;

    # Remove "I'll just describe the bigger rapids here" (meta)
    $text =~ s/,? and I.ll just describe the bigger rapids here//gi;
    $text =~ s/I.ll just describe the bigger rapids here//gi;

    # Remove "Here is a blog about the time we paddled..."
    $text =~ s/Here is a blog about the time[^.]*\.?\s*//gi;

    # Remove "Apologies to the paddlers, whose names I have forgotten..."
    $text =~ s/\(Apologies to[^)]*\)\s*//gi;

    # "Obviously ... I refuse to conform to using the same name" - remove meta
    $text =~ s/Obviously[^.]*I refuse to conform[^.]*\.?\s*//gi;

    # Remove "Also read, Who Needs the Himalayas?"
    # (keep as it's a reference - actually leave it)

    # ------------------------------------------------------------------
    # STEP 2: Named individuals - remove names
    # ------------------------------------------------------------------
    # Remove specific patterns like "Paul Brear", "Jen Hartnett", "J.A.Johnson", "J.Swale"
    $text =~ s/\bPaul Brear\b//g;
    $text =~ s/\bJen Hartnett\b//g;
    $text =~ s/\bIain McKendry\b//g;
    $text =~ s/\bJ\.A\.Johnson\b//g;
    $text =~ s/\bJ\.Swale\b//g;
    $text =~ s/\bDominic Serrammi\b//g;
    $text =~ s/\bHeather Smith\b//g;
    # Remove "Ben Starkie and I paddled this section" → "This section was paddled"
    $text =~ s/[A-Z][a-z]+ [A-Z][a-z]+ and I paddled this section[^.]*\./This section was paddled in that year./g;
    # Remove photo attribution with names "Andy at Kinlochleven"
    $text =~ s/I attach pictures of[^.]*\.?\s*//gi;
    # Remove names following "paddler:" already done above
    # Remove "(Apologies to the paddlers, whose names I have forgotten...)" already done

    # ------------------------------------------------------------------
    # STEP 3: Specific complex multi-word rewrites
    # ------------------------------------------------------------------

    # "we scraped a bit getting over some of these ledges"
    $text =~ s/we scraped a bit getting over some of these ledges/some ledges may require careful navigation at lower levels/gi;

    # "We were short on time so only paddled the last few hundred metres"
    $text =~ s/[Ww]e were short on time so only paddled ([^,]+),/Only the $1 was paddled,/g;

    # "we couldn't persuade anyone on the big-water day because..."
    $text =~ s/[Ww]e couldn.t persuade anyone[^.]*\.?\s*//g;

    # "we'll send you some photos as soon as..."
    $text =~ s/[Ww]e.ll send you some photos[^.]*\.?\s*//g;

    # "We've run this several more times..."
    $text =~ s/[Ww]e.ve run this ([^.]+)\./This section has been run $1./g;
    $text =~ s/[Ww]e've run this ([^.]+)\./This section has been run $1./g;

    # "we've" general
    $text =~ s/\b[Ww]e.ve\b/The group has/g;
    $text =~ s/\b[Ww]e've\b/The group has/g;

    # "we were often left thinking"
    $text =~ s/we were often left thinking/one is often left thinking/gi;
    $text =~ s/We were often left thinking/One is often left thinking/g;

    # "one(er..me!) disappearing from sight" → remove personal aside
    $text =~ s/\(er\.\.me!\)//g;
    $text =~ s/\(er\.\. me!\)//g;

    # "All of our paddlers were caught out by this stopper, with one(er..me!)"
    $text =~ s/All of our paddlers were caught out by this stopper,?\s*with one[^,]*/The stopper has caught paddlers out/gi;

    # "we had 5 swims between 8 of us including a 1km chase of boat..."
    # Keep factual part, remove "us"
    $text =~ s/between \d+ of us/in the group/gi;

    # "we have never been told not park there"
    $text =~ s/we have never been told not park there/no problems have been encountered parking here/gi;

    # "no one has ever complained to us when we use it but make your choice for yourself"
    $text =~ s/no one has ever complained to us when we use it but make your choice for yourself/no complaints have been reported but exercise discretion/gi;
    # "it's not really in the ethos of bothies to have folk drive up to them"
    # (neutral text, keep as is)

    # "You are parking entirely on a private estate... we have car access"
    $text =~ s/it.s only through their openness that we have car access to this run/it is only through their openness that there is car access to this run/gi;
    $text =~ s/no one has ever complained to us/no complaints have been raised/gi;

    # "I thought I'd write in and tell you about" → remove meta opener, keep content
    $text =~ s/I thought I.d write in and tell you about this fun five minutes worth of paddling,?\s*//gi;
    $text =~ s/The paddler thought It would write in and tell you about this fun five minutes worth of paddling,?\s*//gi;

    # "I'll let you see for yourselves" → "inspection recommended"
    $text =~ s/I.ll let you see for yourselves/inspection is recommended/gi;
    $text =~ s/I'll let you see for yourselves/inspection is recommended/gi;

    # "I'll say it again" → remove
    $text =~ s/I.ll say it again[.,]?\s*//gi;
    $text =~ s/I'll say it again[.,]?\s*//gi;

    # "I'll definitely not forget the rapid!" → remove personal comment
    $text =~ s/[^.!?]*I.ll definitely not forget[^.!?]*[.!?]?\s*//gi;
    $text =~ s/[^.!?]*I'll definitely not forget[^.!?]*[.!?]?\s*//gi;

    # "I'll" general → "It is worth"
    $text =~ s/\bI.ll\b/It is worth noting to/gi;
    $text =~ s/\bI'll\b/It is worth noting to/gi;

    # "One of my personal favourites in the UK" → "One of the finest rivers in the UK"
    $text =~ s/\bOne of my personal favourites\b/One of the finest rivers/gi;

    # "to my knowledge no one has bothered" → "no one is known to have"
    $text =~ s/to my knowledge no one has bothered/no one is known to have/gi;

    # "adds:" attribution lines → remove
    $text =~ s/[A-Z][a-z]+ [A-Z][a-z]+ adds:\s*'?//g;
    $text =~ s/[A-Z][a-z]+ [A-Z][a-z]+ has run this at monster flows and notes that/At very high flows/g;
    # Issue #9: this used to be "[A-Z][a-z]+ [A-Z][a-z]+ notes[^.]*\.", which
    # strips ANY "Word Word notes ... ." sentence - a place name like "Loch
    # Morar" reads exactly the same shape as a contributor name. Require a
    # dated parenthetical (e.g. "(May 1999)") after "notes", which a place
    # name would never have, so only genuine dated attributions match.
    $text =~ s/[A-Z][a-z]+ [A-Z][a-z]+ notes \([^)]*\d{4}[^)]*\)[^.]*\.\s*//g;

    # "This is not really bothered what its called" → remove meta
    $text =~ s/[^.!?]*This is not really bothered what its called[^.!?]*[.!?]?\s*//gi;

    # "I suspect" → "The river likely"
    $text =~ s/\bI suspect\b/The river likely/gi;

    # "I wouldn't go/want" in high water
    $text =~ s/I really wouldn.t go in high water[^.]*\./High water is not recommended./gi;
    $text =~ s/I wouldn.t want to spoil the fun anyway[^.!]*[.!]?\s*//gi;
    $text =~ s/I wouldn.t rush back[^.]*\./It is not a river to rush back to in a kayak unless paddling at a high standard./gi;
    $text =~ s/I wouldn.t\b/It is not recommended to/gi;
    $text =~ s/I wouldn't\b/It is not recommended to/gi;

    # "I would say" → "The grading is"
    $text =~ s/\bI would say\b/The assessment is/gi;
    $text =~ s/\bI.d grade it\b/The grade is/gi;
    $text =~ s/2\(3\) is how I.d grade it on an average day\./The grade is 2(3) on an average day./gi;

    # "I have only done/paddled this..."
    $text =~ s/\bI have only done this river in ([^.]+)\./This river has been paddled in $1 only./gi;
    $text =~ s/\bI have only paddled this ([^.]+)\./This section has only been paddled $1./gi;
    $text =~ s/\bI have only done the lower in ([^,]+),/The lower section has only been done in $1,/gi;

    # "I have always had a healthy respect for..."
    $text =~ s/\bI have always had a healthy respect for\b/The/gi;

    # "I have been told that" → "Reportedly"
    $text =~ s/\bI have been told that\b/Reportedly,/gi;
    $text =~ s/\bI have been told\b/It has been reported/gi;

    # "I have heard of it being run at..."
    $text =~ s/\bI have heard of ([^.]+)\./Reports indicate $1./gi;
    $text =~ s/\bI have heard rumours of\b/There are rumours of/gi;

    # "I have never encountered any access problems" → "No access problems have been encountered"
    $text =~ s/\bI have never encountered any access problems[^.]*\./No access problems have been encountered./gi;
    $text =~ s/\bI have never encountered\b/No/gi;

    # "I have not paddled the bottom section" → "The bottom section has not been paddled"
    $text =~ s/\bI have not paddled (the [^,]+),/The section $1 has not been paddled,/gi;
    $text =~ s/\bI have not paddled (them)[^.]*\./Those drops have not been paddled./gi;

    # "I have run/ran all of the falls" → "All of the falls have been run"
    $text =~ s/\bI have ran all of the falls\b/All of the falls have been run/gi;
    $text =~ s/\bI have run all of the falls\b/All of the falls have been run/gi;

    # "I graded the third fall as grade V" → "The third fall is graded V"
    $text =~ s/\bI graded the ([^"]+) as grade ([IVX]+)/The $1 is graded $2/gi;

    # "I don't know" → "It is not known" / "There is no information"
    $text =~ s/\bI don.t know where\b/The exact location of/gi;
    $text =~ s/\bI don.t know how to describe\b/It is difficult to describe/gi;
    $text =~ s/\bI don.t know of any\b/No/gi;
    $text =~ s/\bI don.t know of anybody\b/Nobody is known/gi;
    $text =~ s/\bI don.t know if\b/It is unclear whether/gi;
    $text =~ s/\bI don.t think\b/It does not appear/gi;
    $text =~ s/\bI don.t want to\b/There is no intention to/gi;
    $text =~ s/\bI dont know\b/It is not known/gi;

    # "I can't actually imagine" → "It is difficult to imagine"
    $text =~ s/\bI can.t actually imagine\b/It is difficult to imagine/gi;
    $text =~ s/\bI can.t\b/It is not possible to/gi;
    $text =~ s/\bI can see\b/One can see/gi;

    # "I could be wrong" → "further information may clarify this"
    $text =~ s/\bI could be wrong\b/further information may clarify this/gi;

    # "I think" → "It appears"
    $text =~ s/\bI think\b/It appears/gi;

    # "I believe" → "It is believed"
    $text =~ s/\bI believe\b/It is believed/gi;

    # "I feel" → "It is felt"
    $text =~ s/\bI feel\b/It is felt/gi;

    # "I paddled the river today with 4" → "This section was paddled with a group of 4"
    $text =~ s/\bI paddled the river today with (\d+)[^.]*\./This section was paddled with a group of $1./gi;

    # "I paddled it" → "The river was paddled"
    $text =~ s/\bI paddled it\b/The river was paddled/gi;

    # "I ran it" → "The section was run"
    $text =~ s/\bI ran it\b/The section was run/gi;
    $text =~ s/\bI ran ([^.]+)\./The $1 was run./gi;

    # "I notice that" → "Note that"
    $text =~ s/\bI notice that\b/Note that/gi;

    # "I ended up" → "The result was"
    $text =~ s/\bI ended up ([a-z])/The approach resulted in $1/gi;

    # "I went deep" → "going deep is possible here"
    $text =~ s/\bI went deep on this one\b/going deep is possible here/gi;

    # "I got away with" → "consequences included"
    $text =~ s/\bI got away with ([^.]+)\./The consequences were $1./gi;

    # "I got off feeling short-changed" - personal
    $text =~ s/[^.!?]*I got off feeling short-changed[^.!?]*[.!?]?\s*//gi;

    # "I got the impression that" → "It appears that"
    $text =~ s/\bI got the impression that\b/It appears that/gi;

    # "I got vertically pinned" → "Vertical pinning is possible here"
    $text =~ s/\bI got vertically pinned[^.]*\./Vertical pinning is possible at this drop./gi;

    # "I chose to run this" → "The recommended line is"
    $text =~ s/\bI chose to run this ([^,]+),\s*/Running $1 is recommended, /gi;

    # "I decided" → "The decision was"
    $text =~ s/\bI decided it was a good idea to\b/It is advisable to/gi;
    $text =~ s/\bI decided to\b/The recommended approach is to/gi;
    $text =~ s/\bI decided\b/The decision was/gi;

    # "I presume" → "presumably"
    $text =~ s/\bI presume\b/presumably/gi;

    # "I should say" / "I must admit"
    $text =~ s/\bI must admit[^,]+,\s*//gi;
    $text =~ s/\bI should say\b/it should be noted/gi;

    # "I would definitely recommend" → "It is strongly recommended"
    $text =~ s/\bI would definitely recommend\b/It is strongly recommended/gi;
    $text =~ s/\bI would recommend\b/It is recommended/gi;
    $text =~ s/\bI would not recommend\b/It is not recommended/gi;
    $text =~ s/\bI would\b/It is advisable to/gi;

    # "I could/can" → "It is possible to"
    $text =~ s/\bI could\b/It is possible to/gi;
    $text =~ s/\bI can\b/It is possible to/gi;

    # "I am not aware of" → "No information is available on"
    $text =~ s/\bI am not aware of\b/No information is available on/gi;
    $text =~ s/\bI am not a Range rover driving old buffer\b//gi;
    $text =~ s/[^.!?]*I am not a Range rover[^.!?]*[.!?]?\s*//gi;

    # "I assume" → "It is assumed"
    $text =~ s/\bI assume\b/It is assumed/gi;

    # "I advise" → "It is advised"
    $text =~ s/\bI advise\b/It is advised/gi;

    # "I found" → "The river features" / "There is"
    $text =~ s/\bI found the ([A-Z][a-z]+ [A-Z][a-z]+) to be\b/The $1 is/g;
    $text =~ s/\bI found\b/There is/gi;

    # "I grew up" - personal
    $text =~ s/[^.!?]*I grew up[^.!?]*[.!?]?\s*//gi;

    # "I guess" → "It appears"
    $text =~ s/\bI guess\b/It appears/gi;

    # "I understand" → "Reports suggest"
    $text =~ s/\bI understand\b/Reports suggest/gi;

    # "I attach" → remove
    $text =~ s/[^.!?]*I attach[^.!?]*[.!?]?\s*//gi;

    # "I have just found this page on the internet and although it is probably quite old"
    $text =~ s/[^.!?]*I have just found this page[^.!?]*[.!?]?\s*//gi;

    # "I have never done the rest of the Yarrow, but about 1"
    $text =~ s/\bI have never done the rest of the ([^,]+), but\b/The rest of the $1 has not been paddled, but/gi;

    # "I have not heard of any problems" → "No problems have been reported"
    $text =~ s/\bI have not heard of any problems[^.]*\./No problems have been reported./gi;

    # "I have always" → remove/rephrase
    $text =~ s/\bI have always\b/There has always been/gi;

    # "I have done it twice" → "This section has been done twice"
    $text =~ s/\bI have done it (\w+)[^.]*\./This section has been run $1./gi;

    # "I have only done this" → "This has only been done"
    $text =~ s/\bI have only done this\b/This has only been done/gi;

    # "I have run" → "The section has been run"
    $text =~ s/\bI have run\b/The section has been run/gi;

    # "I haven't run" → "The section has not been run"
    $text =~ s/\bI haven.t run\b/The section has not been run/gi;

    # "I haven't paddled the last mile" → "The last mile has not been paddled"
    $text =~ s/I haven.t paddled (the [^.]+)\)/the $1 has not been paddled)/gi;
    $text =~ s/I haven.t paddled (the [^.]+)\./The $1 has not been paddled./gi;

    # "I'd" contractions
    $text =~ s/\bI.d\b/It would/gi;

    # "I've" contractions
    $text =~ s/\bI've (done it|paddled it|run it|done this)\b/This has been paddled/gi;
    $text =~ s/\bI've\b/It has been/gi;
    $text =~ s/\bI.ve\b/It has been/gi;

    # "I'm" → impersonal
    $text =~ s/\bI.m not going to bother[^.]*\.?\s*//gi;
    $text =~ s/\bI.m not\b/This is not/gi;
    $text =~ s/\bI.m\b/This is/gi;

    # Remaining bare "I " followed by verb
    $text =~ s/\bI \b/The paddler /gi;

    # ------------------------------------------------------------------
    # STEP 4: "we/our/us" patterns
    # ------------------------------------------------------------------

    # "We got on" → "Put in"
    $text =~ s/\b[Ww]e got on\b/Put in/g;

    # "We got into/in" → "Put in at"
    $text =~ s/\b[Ww]e got into\b/Put in at/g;
    $text =~ s/\b[Ww]e got in\b/Put in/g;

    # "We got out" / "got out" → "Take out"
    $text =~ s/\b[Ww]e got out\b/Take out/g;
    $text =~ s/\bgot out\b/take out/g;

    # "We ran it the day after..." special case
    $text =~ s/\b[Ww]e ran it the day after the rain stopped after/Best run the day after rain stops following/g;
    $text =~ s/\b[Ww]e ran it the day after rain stopped after/Best run the day after rain stops following/g;
    $text =~ s/\b[Ww]e ran it at ([^.]+)\./The section was run at $1./g;
    $text =~ s/\b[Ww]e ran it\b/The section was run/g;
    $text =~ s/\b[Ww]e ran ([^.]+) down to\b/The run went from $1 down to/g;
    $text =~ s/\b[Ww]e ran\b/The section was run/g;

    # "We paddled this bank-full after rain"
    $text =~ s/\b[Ww]e paddled this bank-full after rain\b/This river runs best at bank-full after heavy rain/gi;

    # "We paddled this in semi-spate"
    $text =~ s/\b[Ww]e paddled this in ([^.]+)\./This section was paddled in $1./g;
    $text =~ s/\b[Ww]e paddled it ([^.]+)\./This section was paddled $1./g;

    # "We have not paddled this, but drove down it"
    $text =~ s/\b[Ww]e have not paddled this, but drove down it[^.]*\./This section has not been fully paddled, but can be scouted by road./g;

    # "We have not paddled" → "This section has not been paddled"
    $text =~ s/\b[Ww]e have not paddled\b/This section has not been paddled/g;

    # "We put in on/at" → "Put in on/at"
    $text =~ s/\b[Ww]e put in (on|at|in|just|below|above)\b/Put in $1/g;
    $text =~ s/\b[Ww]e put in\b/Put in/g;

    # "We took out at" → "Take out at"
    $text =~ s/\b[Ww]e took out at\b/Take out at/g;
    $text =~ s/\b[Ww]e took out\b/Take out/g;

    # "We got to" → "Reach"
    $text =~ s/\b[Ww]e got to\b/Reach/g;

    # "We found a" → "There is a"
    $text =~ s/\b[Ww]e found a\b/There is a/g;
    $text =~ s/\b[Ww]e found that\b/It was found that/g;
    $text =~ s/\b[Ww]e found\b/The group found/g;

    # "We came to" → "There is" / "Arriving at"
    $text =~ s/\b[Ww]e came to\b/Arriving at/g;
    $text =~ s/\b[Ww]e come to\b/Arriving at/g;

    # "we came across" → "there is"
    $text =~ s/\b[Ww]e came across\b/There is/g;

    # "We actually continued" → "The trip can be continued"
    $text =~ s/\b[Ww]e actually continued\b/The trip can be continued/g;

    # "We continued" → "Continuing"
    $text =~ s/\b[Ww]e continued\b/Continuing/g;
    $text =~ s/\b[Ww]e continue\b/Continue/g;

    # "We would/could" → impersonal
    $text =~ s/\b[Ww]e would/It is possible to/g;
    $text =~ s/\b[Ww]e could/It is possible to/g;

    # "We decided" → "The group decided"
    $text =~ s/\b[Ww]e decided to walk off\b/portaging is recommended here/g;
    $text =~ s/\b[Ww]e decided to\b/The recommended approach is to/g;
    $text =~ s/\b[Ww]e decided\b/The decision was/g;

    # "We didn't attempt" → "Attempting ... was not done"
    $text =~ s/\b[Ww]e didn.t attempt a paddle[^.]*\./Paddling was not attempted on that occasion./g;
    $text =~ s/\b[Ww]e didn.t\b/This was not done/g;

    # "We don't/didn't" → impersonal
    $text =~ s/\b[Ww]e don.t\b/There is no/g;

    # "We recommend" → "It is recommended"
    $text =~ s/\b[Ww]e recommend\b/It is recommended/g;

    # "We suggest" → "It is suggested"
    $text =~ s/\b[Ww]e suggest\b/It is suggested/g;

    # "We paddled" → "The section was paddled"
    $text =~ s/\b[Ww]e paddled\b/The section was paddled/g;

    # "We walked" → "Walk"
    $text =~ s/\b[Ww]e walked\b/Walk/g;

    # "we walk" → "walk"
    $text =~ s/\b[Ww]e walk\b/Walk/g;

    # "We carried" → "Carry"
    $text =~ s/\b[Ww]e carried\b/The group carried/g;

    # "We take/took" → "Take"
    $text =~ s/\b[Ww]e took\b/Take/g;
    $text =~ s/\b[Ww]e take\b/Take/g;

    # "We made" → "The group made"
    $text =~ s/\b[Ww]e made\b/The group made/g;

    # "We were told" → "It has been reported"
    $text =~ s/\b[Ww]e were told\b/It has been reported/g;

    # "We were able to" → "It is possible to"
    $text =~ s/\b[Ww]e were able to\b/It is possible to/g;

    # "We were not for trying" → "this was not attempted"
    $text =~ s/\b[Ww]e were not for trying\b/this was not attempted/g;

    # "We were" → "Conditions were" (most common context)
    $text =~ s/\b[Ww]e were\b/The group was/g;

    # "We are/we're" → impersonal
    $text =~ s/\b[Ww]e are\b/This is/g;
    $text =~ s/\b[Ww]e.re\b/This is/g;

    # "We have" → "There is/has been"
    $text =~ s/\b[Ww]e have had\b/There have been/g;
    $text =~ s/\b[Ww]e have never been told not park there\b/No problems have been encountered parking here/g;
    $text =~ s/\b[Ww]e have never been\b/There has been no/g;
    $text =~ s/\b[Ww]e have never\b/This has never/g;
    $text =~ s/\b[Ww]e have\b/There is/g;

    # "we had" → "the group had" / context-dependent
    $text =~ s/\b[Ww]e had none\b/No access problems were encountered/g;
    $text =~ s/\b[Ww]e had\b/The group had/g;

    # "We will" → "Future parties may"
    $text =~ s/\b[Ww]e will return for\b/The/g;
    $text =~ s/\b[Ww]e will\b/Future parties may/g;

    # "We won't/wouldn't" → "It is not recommended to"
    $text =~ s/\b[Ww]e won.t\b/It is not recommended to/g;

    # "we" + past/present verb → "the group"
    # Generic remaining "we" replacements
    $text =~ s/\b[Ww]e\b/The group/g;

    # "our" → "the"
    $text =~ s/\bour put-?in\b/the put-in/gi;
    $text =~ s/\bour take-?out\b/the take-out/gi;
    $text =~ s/\bour group\b/the group/gi;
    $text =~ s/\bour boats\b/the boats/gi;
    $text =~ s/\bour trip\b/the trip/gi;
    $text =~ s/\bour experience\b/past experience/gi;
    $text =~ s/\bour point of view\b/one perspective/gi;
    $text =~ s/\bour more able paddlers\b/the more able paddlers/gi;
    $text =~ s/\bour paddlers\b/the paddlers/gi;
    $text =~ s/\bour wet gear\b/wet gear/gi;
    $text =~ s/\bour\b/the/gi;

    # "us" in first-person context → rephrase
    $text =~ s/\bfor us\b/for paddlers/gi;
    $text =~ s/\bwith us\b/in the group/gi;
    $text =~ s/\bjoin us\b/join the group/gi;
    $text =~ s/\bto us\b/to paddlers/gi;
    $text =~ s/\bat us\b/at the group/gi;
    $text =~ s/\b complained to us\b/ complaints have been raised/gi;

    # "myself" → "oneself"
    $text =~ s/\bmyself\b/oneself/gi;

    # "ourselves" → "the group"
    $text =~ s/\bourselves\b/the group/gi;

    # ------------------------------------------------------------------
    # STEP 5: Remaining personal names / references
    # ------------------------------------------------------------------
    # Remove "Jonathan" standalone
    # Remove first names in context like "Ben Starkie and I"
    # These were handled above; catch-all for remaining common ones:
    $text =~ s/\bJonathan\b//g;

    # ------------------------------------------------------------------
    # STEP 6: Clean up
    # ------------------------------------------------------------------
    # Fix "so The river likely" → "so the river likely"
    $text =~ s/\bso The river likely\b/so the river likely/g;

    # Fix "but keep well clear and they seemed freindly enough"
    $text =~ s/,?\s*and they seemed fri[ei]ndly enough//gi;
    $text =~ s/,?\s*but they seemed fri[ei]ndly enough//gi;
    $text =~ s/,?\s*they seemed fri[ei]ndly enough//gi;

    # "Several people where fly fishing... but keep well clear."
    # → remove "but" leftover
    $text =~ s/\bbut keep well clear\b/keep well clear/gi;
    $text =~ s/\bwe kept well clear\b/keep well clear/gi;
    $text =~ s/\bwe keep well clear\b/keep well clear/gi;

    # Fix "Some ledges may require careful navigation at lower levels getting over some of these ledges."
    $text =~ s/Some ledges may require careful navigation at lower levels getting over some of these ledges/Some ledges may require careful navigation at lower levels/gi;

    # Fix "the group wouldn't have" → "it would not have been possible"
    $text =~ s/the group wouldn.t have got down it/it would not have been possible to paddle it/gi;

    # Fix "Passing the same spot 2 days of dry August weather later, the group wouldn't..."
    # already handled above

    # Fix "The group wouldn't" → "It is not possible to"
    $text =~ s/The group wouldn.t\b/It would not be possible to/gi;
    $text =~ s/the group wouldn.t\b/it would not be possible to/gi;
    $text =~ s/The group wouldn't\b/It would not be possible to/gi;

    # Fix artefact: "The group really don't want to damage relations" → "It is important not to damage relations"
    $text =~ s/The group really don.t want to damage relations/It is important not to damage relations/gi;
    $text =~ s/The group really don't want to damage relations/It is important not to damage relations/gi;

    # Fix "The group don't" → "It is not advisable to"
    $text =~ s/The group don.t\b/It is not advisable to/gi;
    $text =~ s/The group don't\b/It is not advisable to/gi;

    # Fix "The paddler thought It would write in" → remove that opener
    $text =~ s/^The paddler thought It would write in and tell you[^.]*\.\s*//i;

    # Fix "comparable to a scaled - up garden centre water feature" - keep as descriptive
    # (neutral descriptive, leave as-is)

    # Issue #9: a "'[A-Z][a-z]+ [A-Z][a-z]+ [^']*'" rule used to live here,
    # intended to strip stray quoted attribution blocks like "'I ventured...'"
    # when preceded by a contributor name. In practice it matched from the
    # *first* two-capitalised-word run inside any quoted passage through to
    # the next apostrophe/closing quote - since apostrophes are common in
    # ordinary prose (contractions, quoted asides), this frequently ate
    # through hundreds of characters of genuine factual/hazard text (e.g. a
    # quoted hazard note beginning "The North Sannox has a large tree below
    # the grade 4 fall, inspect from the bottom bridge before running." was
    # deleted wholesale because it starts with two capitalised words). No
    # verified-genuine match for this rule was found in the real dataset, so
    # it has been removed rather than narrowed.

    # Fix the Tilt "I'll definitely not forget" already handled above
    # Fix remaining "I'll" → "It is worth"
    $text =~ s/\bI.ll\b/It is/gi;
    $text =~ s/\bI'll\b/It is/gi;

    # Double spaces
    $text =~ s/\s{2,}/ /g;
    # Clean up punctuation artifacts
    $text =~ s/ \././g;
    $text =~ s/ ,/,/g;
    $text =~ s/,\s*,/,/g;
    $text =~ s/\.\s*\././g;
    $text =~ s/\.{2,}/./g unless $text =~ /\.\.\./;  # protect ellipsis
    # Remove empty parentheses
    $text =~ s/\(\s*\)//g;
    # Remove lines that are purely whitespace after cleanup
    $text =~ s/^\s+//;
    $text =~ s/\s+$//;

    return $text;
}

# Process all entries
for my $entry (@$data) {
    for my $field (@fields_to_rewrite) {
        if (exists $entry->{$field} && defined $entry->{$field}) {
            $entry->{$field} = rewrite_text($entry->{$field});
        }
    }
}

# Write output
my $json = JSON::PP->new->utf8(0)->pretty(1)->canonical(0)->encode($data);

open my $out_fh, '>:utf8', $output_file or die "Cannot write $output_file: $!";
print $out_fh $json;
close $out_fh;

print "Done. Written to $output_file\n";
print "Entries processed: ", scalar(@$data), "\n";
