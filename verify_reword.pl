#!/usr/bin/perl
# verify_reword.pl
#
# Safety-net verification harness for the reword pipeline (see issue #12).
#
# The reword script (reword_rivers2.pl) rewrites factual, safety-relevant
# river guide prose using a long chain of regex substitutions. A single
# over-broad regex can silently delete a whole sentence (a place name, a
# hazard, a grade) with no error and no warning. This script compares the
# original data against the reworded output field-by-field and flags any
# field that shrank suspiciously, so a human can eyeball the damage before
# the reworded file is trusted or shipped.
#
# Usage:
#   perl verify_reword.pl [original.json] [reworded.json] [--strict]
#
# With no arguments, compares the repo's own
# scotland_rivers_detail.json / scotland_rivers_detail_reworded.json.
#
# --strict causes the script to exit non-zero if anything is flagged
# (useful in CI). Without it, warnings are printed but the exit code is 0 -
# the rewrite legitimately removes some text, so flags are for a human to
# review, not an automatic failure.

use strict;
use warnings;
use JSON::PP;
use utf8;
use open ':std', ':encoding(UTF-8)';
use FindBin qw($RealBin);

# Fraction of characters a field may lose before being flagged.
my $SHRINK_THRESHOLD = 0.40;

# If the source field is at least this many characters, flag the field if
# the reworded version drops below this absolute length too - catches
# fields that were gutted down to almost nothing even if the source was
# only moderately long.
my $MIN_SURVIVING_LENGTH = 20;

my @fields_to_check = qw(
    where_is_it water_level general_description
    other_notes major_hazards access_hassles
);

my $strict = 0;
my @positional;
for my $arg (@ARGV) {
    if ($arg eq '--strict') {
        $strict = 1;
    } else {
        push @positional, $arg;
    }
}

my $original_file = $positional[0] // "$RealBin/scotland_rivers_detail.json";
my $reworded_file = $positional[1] // "$RealBin/scotland_rivers_detail_reworded.json";

sub read_json_file {
    my ($file) = @_;
    open my $fh, '<:utf8', $file or die "Cannot open $file: $!";
    local $/;
    my $raw = <$fh>;
    close $fh;
    return JSON::PP->new->utf8(0)->decode($raw);
}

my $original = read_json_file($original_file);
my $reworded = read_json_file($reworded_file);

if (scalar(@$original) != scalar(@$reworded)) {
    warn sprintf(
        "WARNING: entry count differs - original has %d, reworded has %d\n",
        scalar(@$original), scalar(@$reworded)
    );
}

my $fields_processed = 0;
my $fields_flagged   = 0;
my @flags;

for my $i (0 .. $#$original) {
    my $orig_entry = $original->[$i];
    my $rew_entry  = $reworded->[$i] // {};
    my $river_name = $orig_entry->{name_of_river} // "entry #$i";

    for my $field (@fields_to_check) {
        next unless exists $orig_entry->{$field}
            && defined $orig_entry->{$field}
            && $orig_entry->{$field} ne '';

        my $before = $orig_entry->{$field};
        my $after  = defined $rew_entry->{$field} ? $rew_entry->{$field} : '';

        my $before_len = length($before);
        next unless $before_len > 0;
        my $after_len = length($after);

        $fields_processed++;

        my $chars_lost = $before_len - $after_len;
        my $pct_lost   = $chars_lost / $before_len;

        my $reason;
        if ($pct_lost >= $SHRINK_THRESHOLD) {
            $reason = sprintf("lost %.0f%% of content", $pct_lost * 100);
        } elsif ($before_len >= ($MIN_SURVIVING_LENGTH * 2) && $after_len < $MIN_SURVIVING_LENGTH) {
            $reason = sprintf("dropped to %d chars (source was %d)", $after_len, $before_len);
        }

        next unless $reason;

        $fields_flagged++;
        push @flags, {
            river      => $river_name,
            field      => $field,
            before_len => $before_len,
            after_len  => $after_len,
            chars_lost => $chars_lost,
            reason     => $reason,
        };
    }
}

for my $f (@flags) {
    printf "WARN  %-28s %-22s before=%-5d after=%-5d lost=%-5d (%s)\n",
        $f->{river}, $f->{field}, $f->{before_len}, $f->{after_len},
        $f->{chars_lost}, $f->{reason};
}

printf "\nVerification summary: %d field%s processed, %d flagged " .
    "(threshold: >%.0f%% loss or drop below %d chars for long fields)\n",
    $fields_processed, ($fields_processed == 1 ? '' : 's'),
    $fields_flagged, $SHRINK_THRESHOLD * 100, $MIN_SURVIVING_LENGTH;

if ($strict && $fields_flagged > 0) {
    print "Exiting non-zero: --strict was given and $fields_flagged field(s) were flagged.\n";
    exit 1;
}

exit 0;
