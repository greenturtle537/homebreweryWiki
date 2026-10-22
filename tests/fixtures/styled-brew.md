```css
.page { padding-bottom : 1.1cm; }
.note { border-color : rgb( 86, 108, 24 ); }
```

# The Styled Sheet

This brew opens with a stylesheet fence, the way the Homebrewery demo does.
The fence is page style, not content: it must not appear above this heading,
and the page must honour the rules it carries.

The first rule shortens the page's bottom padding from the theme's 1.7cm to
1.1cm. On paper the difference is small; in the renderer it is measurable, and
it is what proves the fence reached the page instead of the text stream.

| Sheet | Requested padding-bottom | Source |
|---|---|---|
| This one | 1.1cm | leading css fence |
| Unstyled | 1.7cm | theme default |

{{note
### Checked by the parser
If the fence had been rendered as markdown, a 101px code block would sit above
the heading and this note would start lower on the page.
}}

A brew without a fence behaves exactly as before, so the presence of a style
element is a reliable signal rather than an accident.
