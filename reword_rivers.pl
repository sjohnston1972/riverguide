#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use utf8;
use open ':std', ':encoding(UTF-8)';

my $input_file  = 'C:/docker/net-core/web-projects/rivers2/scotland_rivers_detail.json';
my $output_file = 'C:/docker/net-core/web-projects/rivers2/scotland_rivers_detail_reworded.json';

# Read input
my $raw = do {
    local $/;
    open my $fh, '<:utf8', $input_file or die "Cannot open $input_file: $!";
    <$fh>;
};

my $data = JSON::PP->new->utf8(0)->decode($raw);

my @fields_to_rewrite = qw(where_is_it water_level general_description other_notes major_hazards access_hassles);

sub rewrite_text {
    my ($text, $field) = @_;
    return $text unless defined $text && $text ne '';

    # -------------------------------------------------------------------------
    # 1. Remove names of individuals
    # -------------------------------------------------------------------------
    # Remove "First recorded descent" lines with names/initials
    $text =~ s/First recorded descent[^.]*\.?\s*//gi;
    # Remove photo/paddler credit lines
    $text =~ s/Paddler:\s*\S+\s+\S+[,.]?\s*Photo:[^\n.]*[.\n]?//gi;
    $text =~ s/Photo:\s*[^.\n]*[.\n]?//gi;
    # Remove specific names (common ones found in the data)
    my @names = (
        'Paul Brear', 'Jen Hartnett', 'J\.A\.Johnson', 'J\.Swale',
        'Jonathan', 'Jon ', 'J\. ', 'Jon,',
    );
    for my $name (@names) {
        $text =~ s/\b$name\b//g;
    }

    # -------------------------------------------------------------------------
    # 2. Remove community calls to action
    # -------------------------------------------------------------------------
    $text =~ s/[^.]*let us know what you find[^.]*\.?//gi;
    $text =~ s/[^.]*tell us what you find[^.]*\.?//gi;
    $text =~ s/[^.]*Anyone seen it[^?]*\??//gi;
    $text =~ s/[^.]*if you find something[^.]*\.?//gi;
    $text =~ s/[^.]*send us photos[^.]*\.?//gi;
    $text =~ s/[^.]*let us know[^.]*\.?//gi;
    $text =~ s/[^.]*take pictures if you do[^!]*[!.]?//gi;
    $text =~ s/see how far you can hike and[^!]*[!.]?\s*//gi;

    # -------------------------------------------------------------------------
    # 3. Remove/rewrite first-person language
    # -------------------------------------------------------------------------

    # "we don't have proper rivers up here so we're desperate" – remove
    $text =~ s/[Ww]e don.t have proper rivers up here so we.re desperate[^.]*\.?\s*//g;

    # "good for washing salt and sand off the kit" – remove
    $text =~ s/,?\s*good for washing salt and sand off the kit[^.]*\.?//gi;

    # "why bother? a) It's there b) it seemed like a good idea" – remove
    $text =~ s/why bother\?[^)]*\)\s*it seemed like a good idea[^.]*\.?\s*//gi;
    $text =~ s/[Ww]hy bother\?[^.]*\.?\s*//g;

    # "one(er..me!) disappearing from sight" – clean up personal anecdote
    $text =~ s/\(er\.\.me!\)//g;

    # "we couldn't persuade anyone" → remove sentence
    $text =~ s/[Ww]e couldn.t persuade anyone[^.]*\.?\s*//g;

    # "we were often left thinking" → "one is often left thinking"
    $text =~ s/[Ww]e were often left thinking/One is often left thinking/g;

    # "I suspect" → "The river likely"
    $text =~ s/\bI suspect\b/The river likely/gi;

    # "I wouldn't go in high water" → "High water is not recommended"
    $text =~ s/I wouldn.t go in high water/High water is not recommended/gi;

    # "I'm not going to bother putting grades" – remove meta-comment
    $text =~ s/I.m not going to bother putting grades[^.]*\.?\s*//gi;

    # "we scraped a bit" → "Some ledges may require careful navigation at lower levels"
    $text =~ s/\bwe scraped a bit\b/Some ledges may require careful navigation at lower levels/gi;
    $text =~ s/\bwe scraped\b/Careful navigation may be needed/gi;

    # "We got on" / "We got into" → "Put in"
    $text =~ s/\bWe got on\b/Put in/g;
    $text =~ s/\bwe got on\b/put in/g;
    $text =~ s/\bWe got into\b/Put in at/g;
    $text =~ s/\bwe got into\b/put in at/g;

    # "We got out" / "Got out" → "Take out"
    $text =~ s/\bWe got out\b/Take out/g;
    $text =~ s/\bwe got out\b/take out/g;
    $text =~ s/\bGot out\b/Take out/g;
    $text =~ s/\bgot out\b/take out/g;

    # "We ran it" → "Best run" or "The river runs"
    $text =~ s/\bWe ran it the day after the rain stopped after/Best run the day after rain stops following/g;
    $text =~ s/\bWe ran it the day after rain stopped after/Best run the day after rain stops following/g;
    $text =~ s/\bWe ran it\b/The section runs/g;
    $text =~ s/\bwe ran it\b/the section runs/g;

    # "We paddled this bank-full after rain" → "This river runs best at bank-full after heavy rain"
    $text =~ s/\bWe paddled this bank-full after rain\b/This river runs best at bank-full after heavy rain/gi;
    $text =~ s/\bwe paddled this bank-full after rain\b/This river runs best at bank-full after heavy rain/gi;

    # "We have not paddled this, but drove down it" → "This section has not been fully paddled, but can be scouted by road"
    $text =~ s/\bWe have not paddled this, but drove down it[^.]*\./This section has not been fully paddled, but can be scouted by road./gi;

    # "All of our paddlers were caught out by this stopper" → "The stopper has caught paddlers out"
    $text =~ s/All of our paddlers were caught out by this stopper/The stopper has caught paddlers out/gi;

    # General "we paddled" / "We paddled" → "This section was paddled" / "The river can be paddled"
    $text =~ s/\bWe paddled\b/The section was paddled/g;
    $text =~ s/\bwe paddled\b/the section was paddled/g;

    # "We were short on time so only paddled" → "Only the last portion was paddled"
    $text =~ s/\bWe were short on time so only paddled[^,]*,/Only the final section was paddled,/gi;

    # "We actually continued" → "The trip can be continued"
    $text =~ s/\bWe actually continued\b/The trip can be continued/g;
    $text =~ s/\bwe actually continued\b/the trip can be continued/g;

    # "We continued" → "Continue"
    $text =~ s/\bWe continued\b/Continuing/g;
    $text =~ s/\bwe continued\b/continuing/g;

    # "We found" → "The river features" or just remove "we found"
    $text =~ s/\bWe found\b/There is/g;
    $text =~ s/\bwe found\b/there is/g;

    # "we have found" → "it has been found"
    $text =~ s/\bwe have found\b/it has been found/gi;
    $text =~ s/\bWe have found\b/It has been found/gi;

    # "we have" → "it has"
    $text =~ s/\bWe have\b/There is/g;
    $text =~ s/\bwe have\b/there is/g;

    # "We walked" → "Walk"
    $text =~ s/\bWe walked\b/Walk/g;
    $text =~ s/\bwe walked\b/walk/g;

    # "we walk" → "walk"
    $text =~ s/\bwe walk\b/walk/g;
    $text =~ s/\bWe walk\b/Walk/g;

    # "we carried" → "carry"
    $text =~ s/\bwe carried\b/carry/g;
    $text =~ s/\bWe carried\b/Carry/g;

    # "we carry" → "carry"
    $text =~ s/\bwe carry\b/carry/g;

    # "we put in" → "put in"
    $text =~ s/\bwe put in\b/put in/gi;
    $text =~ s/\bWe put in\b/Put in/g;

    # "our put in" / "our take out" → "the put in" / "the take out"
    $text =~ s/\bour put in\b/the put in/gi;
    $text =~ s/\bour take out\b/the take out/gi;
    $text =~ s/\bour takeout\b/the takeout/gi;

    # "we kept well clear" → "keep well clear"
    $text =~ s/\bwe kept well clear\b/keep well clear/gi;
    $text =~ s/\bwe keep well clear\b/keep well clear/gi;

    # "they seemed friendly enough" - remove (part of a personal anecdote)
    $text =~ s/,?\s*and they seemed fri[ei]ndly enough//gi;
    $text =~ s/,?\s*but they seemed fri[ei]ndly enough//gi;
    $text =~ s/,?\s*they seemed fri[ei]ndly enough//gi;

    # "we kept" → "keep"
    $text =~ s/\bwe kept\b/keep/gi;

    # "we suggest" / "We suggest" → "It is suggested"
    $text =~ s/\bWe suggest\b/It is suggested/g;
    $text =~ s/\bwe suggest\b/it is suggested/g;

    # "we recommend" → "it is recommended"
    $text =~ s/\bwe recommend\b/it is recommended/gi;
    $text =~ s/\bWe recommend\b/It is recommended/g;

    # "We took" → "Take"
    $text =~ s/\bWe took\b/Take/g;
    $text =~ s/\bwe took\b/take/g;

    # "We did" → "This was done" / remove
    $text =~ s/\bWe did\b/This was done/g;
    $text =~ s/\bwe did\b/this was done/g;

    # "we do" → general rephrase
    $text =~ s/\bwe do\b/it does/gi;

    # "we drove" → "drive"
    $text =~ s/\bwe drove\b/drive/gi;
    $text =~ s/\bWe drove\b/Drive/g;

    # "we drive" → "drive"
    $text =~ s/\bwe drive\b/drive/gi;

    # "our group" → "the group"
    $text =~ s/\bour group\b/the group/gi;

    # "our boats" → "the boats"
    $text =~ s/\bour boats\b/the boats/gi;

    # "our trip" → "the trip"
    $text =~ s/\bour trip\b/the trip/gi;

    # Remaining "our" → "the"
    $text =~ s/\bour\b/the/gi;

    # "we're" / "we are" → "it is" / "this is"
    $text =~ s/\bwe're\b/it is/gi;
    $text =~ s/\bwe are\b/it is/gi;

    # "we were" → "it was" / "the conditions were"
    $text =~ s/\bwe were\b/conditions were/gi;
    $text =~ s/\bWe were\b/Conditions were/g;

    # Remaining "we" → remove or rephrase
    $text =~ s/\bWe\b/The group/g;
    $text =~ s/\bwe\b/the group/g;

    # "I " (first person singular)
    $text =~ s/\bI suspect\b/The river likely/gi;  # already done above, belt+braces
    $text =~ s/\bI wouldn't\b/It is not advisable to/gi;
    $text =~ s/\bI would\b/It is advisable to/gi;
    $text =~ s/\bI'm not\b/This guide does not/gi;
    $text =~ s/\bI'm\b/This is/gi;
    $text =~ s/\bI don't\b/There is no/gi;
    $text =~ s/\bI didn't\b/There was no/gi;
    $text =~ s/\bI think\b/It appears/gi;
    $text =~ s/\bI believe\b/It is believed/gi;
    $text =~ s/\bI found\b/The river features/gi;
    $text =~ s/\bI \b/The paddler /gi;

    # "myself" → "oneself" / remove
    $text =~ s/\bmyself\b/oneself/gi;
    # "ourselves" → remove or rephrase
    $text =~ s/\bourselves\b/the group/gi;

    # "us" when used as first-person object (tricky - only when preceded by "for", "with", "to", "at", "of")
    # Be conservative - only handle clear cases
    $text =~ s/\bfor us\b/for paddlers/gi;
    $text =~ s/\bwith us\b/with the group/gi;
    $text =~ s/\bto us\b/in this area/gi;
    $text =~ s/\bat us\b/at paddlers/gi;
    $text =~ s/\bjoin us\b/join the group/gi;

    # -------------------------------------------------------------------------
    # 4. Clean up double spaces and punctuation artifacts
    # -------------------------------------------------------------------------
    $text =~ s/\s{2,}/ /g;
    $text =~ s/\s+([,.])/\1/g;
    $text =~ s/,\s*,/,/g;
    $text =~ s/\.\s*\././g;

    return $text;
}

# Process all entries
for my $entry (@$data) {
    for my $field (@fields_to_rewrite) {
        if (exists $entry->{$field} && defined $entry->{$field}) {
            $entry->{$field} = rewrite_text($entry->{$field}, $field);
        }
    }
}

# Write output
my $json = JSON::PP->new->utf8(0)->pretty(1)->canonical(0)->encode($data);

open my $out_fh, '>:utf8', $output_file or die "Cannot write $output_file: $!";
print $out_fh $json;
close $out_fh;

print "Done. Written to $output_file\n";
