# The Brewer's Almanac

A rich fixture for the parity harness (E4B1). The old fixture was three pages of one heading and one sentence, so a page whose content overran its columns could clip silently and no screenshot noticed. This sheet carries the elements the theme actually styles — headings, prose, lists, a blockquote, a note, a table — and enough of them that page one wants more columns than fit. The overflow is the point, not an accident: `column-fill: auto` lays the excess into further columns past the page edge and the theme clips them, so page one must be flagged by the renderer and the golden must show exactly that clipping.

The measure of a brew is not how much ink it spends but whether the ink is where the reader looks. Everything below is filler with a pulse.

## Chapter One: Waters

Water is the body of the drink and the least examined ingredient in it. A brewer who can taste the difference between chalk and gypsum is already ahead of the room, and a brewer who cannot will discover the difference in the fermenter, at volume, with witnesses.

Spring water varies by the mile. Rainwater is soft and nearly free of minerals, and beer made from it tastes thin until something is added to it. Well water carries whatever the rock beneath the cellar decided to give up, which is sometimes iron and sometimes nothing at all.

### Hardness and Alkalinity

Hardness is a measure of dissolved calcium and magnesium; alkalinity is a measure of what resists acid. They are related the way height and weight are related, which is to say a brewer who treats them as the same number will produce a beer that tastes of the mistake.

A pale mash wants soft water and a dark mash tolerates, even prefers, water with more backbone. Adjust the water to the grain, never the other way around, unless the grain is already in the tun, in which case adjust quickly.

#### A Note on Measures

{{note
##### A Note on Measures
Brewers argue about units the way other people argue about politics: loudly, and without changing anyone's mind. Pick one system per recipe and write it down. A recipe with grams in the grain bill and ounces in the hops is a recipe that will one day be brewed by someone else, badly.
}}

## Chapter Two: Grains

Barley is malted by soaking it until it sprouts and then drying it before it becomes a plant. The drying decides the colour, the flavour and, for practical purposes, the beer.

| Grain | Colour (SRM) | Use |
|:------|:------------:|:----|
| Pilsner malt | 1 – 2 | base for pale beers |
| Pale ale malt | 3 – 4 | base for everything else |
| Munich malt | 8 – 12 | body and bread crust |
| Crystal 40 | 40 | caramel sweetness |
| Crystal 120 | 120 | dried fruit, restraint |
| Roasted barley | 300+ | stout, in small doses |
| Chocolate malt | 350 | colour without astringency |

Milling matters less than brewers pretend and more than they hope. A crush that is too fine gives a stuck sparge and a long afternoon; a crush that is too coarse gives a low yield and a thin beer. Set the mill once and leave it alone.

## Chapter Three: Yeast

Yeast is not an ingredient so much as an employee. It arrives with its own opinions about temperature, oxygen and how much work it is willing to do before it flocculates and takes the rest of the afternoon off.

- Pitch enough yeast, and pitch it cool.
- Aerate the wort before pitching, not after.
- Keep the temperature steady; a swinging fermenter tastes of the swing.
- Give the beer time to clean up after itself, because it will.

> "The brewer makes the wort; the yeast makes the beer." A saying repeated by people who have never had a stalled fermentation and by people who have had several and learned nothing.

## Chapter Four: Time

Time is the ingredient nobody bills for and everybody underestimates. A beer that is ready in a week is drinkable in a week and better in three; a beer that is ready in three weeks is drinkable in three and better in six.

The clock also governs the parts of the process that cannot be rushed: the boil, the chill, the conditioning, and the argument about whether the last one is necessary at all.

\column

### An Aside on Patience

The best brewers are not the ones with the most equipment. They are the ones who wrote down what they did, tasted what came out, and did not change six things at once.

\page

# The Second Sheet

## Tables and Columns

The second page exists to prove that the page marker still splits the stack, and that a `\column` inside a later page places its break where the author put it rather than where the flow happens to end.

| Vessel | Volume | Notes |
|:-------|:------:|:------|
| Kettle | 10 L | wide, loses heat fast |
| Mash tun | 12 L | insulated, holds temperature |
| Fermenter | 9 L | one inch of headspace is not enough |
| Bottling bucket | 10 L | the spigot leaks, as spigots do |

\column

### After the Break

Text after a column break on a later page. It should start at the top of the second column, not midway down the first, and the page number should still be the theme's own counter rather than a hard-coded value.
