// The rule docs entries. Each entry covers one problem and lists every rule id, across engines, that reports it.
// Snippets are HTML; rule-docs.ts translates them to each framework, so inline handlers are written as
// on<event>="name()" and void elements without a closing slash. `document` marks snippets of the page itself
// (html, head, body), which Vue, Svelte and Angular keep in their index.html.

export interface Snippet {
    bad: string;
    good: string;
}

export interface Entry {
    rules: string[];
    message: string;
    why: string;
    fix: string;
    /** WCAG 2.2 success criteria the problem fails. */
    wcag: string[];
    act?: ActRule[];
    details?: boolean;
    document?: boolean;
    example: Snippet;
    overrides?: Partial<Record<'html' | 'jsx' | 'vue' | 'svelte' | 'angular' | 'astro', Snippet & { language?: string; file?: string }>>;
}

// Titles of the W3C ACT rules the entries link (https://www.w3.org/WAI/standards-guidelines/act/rules/)
export const ACT_RULES = {
    '23a2a8': 'Image has non-empty accessible name',
    '24afc2': 'Important letter spacing in style attributes is wide enough',
    '2779a5': 'HTML page has non-empty title',
    '2ee8b8': 'Visible label is part of accessible name',
    '2t702h': 'Summary element has non-empty accessible name',
    '307n5z': 'Element with presentational children has no focusable content',
    '46ca7f': 'Element marked as decorative is not exposed',
    '4b1c6c': 'Iframe elements with identical accessible names have equivalent purpose',
    '4e8ab6': 'Element with role attribute has required states and properties',
    '59796f': 'Image button has non-empty accessible name',
    '5b7ae0': 'HTML page lang and xml:lang attributes have matching values',
    '5c01ea': 'ARIA state or property is permitted',
    '5effbb': 'Link in context is descriptive',
    '5f99a7': 'ARIA attribute is defined in WAI-ARIA',
    '674b10': 'Role attribute has valid value',
    '6a7281': 'ARIA state or property has valid value',
    '6cfa84': 'Element with aria-hidden has no content in sequential focus navigation',
    '73f2c2': 'Autocomplete attribute has valid value',
    '78fd32': 'Important line height in style attributes is wide enough',
    '7d6734': 'SVG element with explicit role has non-empty accessible name',
    '80f0bf': 'Audio or video element avoids automatically playing audio',
    '8fc3b6': 'Object element rendering non-text content has non-empty accessible name',
    '97a4e1': 'Button has non-empty accessible name',
    '9e45ec': 'Important word spacing in style attributes is wide enough',
    'a25f45': 'Headers attribute specified on a cell refers to cells in the same table element',
    'afw4f7': 'Text has minimum contrast',
    'akn7bn': 'Iframe with interactive elements is not excluded from tab-order',
    'b33eff': 'Orientation of the page is not restricted using CSS transforms',
    'b4f0c3': 'Meta viewport allows for zoom',
    'b5c3f8': 'HTML page has lang attribute',
    'bc4a75': 'ARIA required owned elements',
    'bc659a': 'Meta element has no refresh delay',
    'bf051a': 'HTML page lang attribute has valid language tag',
    'c487ae': 'Link has non-empty accessible name',
    'cae760': 'Iframe element has non-empty accessible name',
    'cf77f2': 'Bypass Blocks of Repeated Content',
    'd0f69e': 'Table header cell has assigned cells',
    'de46e4': 'Element with lang attribute has valid language tag',
    'e086e5': 'Form field has non-empty accessible name',
    'e7aa44': 'Audio element content has text alternative',
    'eac66b': 'Video element auditory content has accessible alternative',
    'f51b46': 'Video element auditory content has captions',
    'ff89c9': 'ARIA required context role',
    'ffd0e9': 'Heading has non-empty accessible name',
    'kb1m8s': 'ARIA global properties not used where prohibited',
    'm6b1q3': 'Menuitem has non-empty accessible name',
    'qt1vmo': 'Image accessible name is descriptive'
} as const;

export type ActRule = keyof typeof ACT_RULES;

// Rule ids per engine; eslint-plugin-astro reuses the jsx-a11y rules
const jsx = (rule: string) => [`jsx-a11y-x/${rule}`, `astro/jsx-a11y/${rule}`];
const vue = (rule: string) => `vuejs-accessibility/${rule}`;
const ng = (rule: string) => `@angular-eslint/template/${rule}`;
const svelte = (rule: string) => `svelte/${rule}`;
const htmlEslint = (rule: string) => `@html-eslint/${rule}`;
const own = (rule: string) => `allyproof/${rule}`;

export const ENTRIES: Entry[] = [
    // Text alternatives
    {
        rules: [...jsx('alt-text'), vue('alt-text'), ng('alt-text'), 'image-alt'],
        message: 'Images need a text alternative',
        why: 'Screen reader users hear nothing, or just the file name, for an image without alt text and miss what it shows.',
        fix: 'Add an alt attribute that says what the image conveys; use alt="" for a purely decorative image.',
        wcag: ['1.1.1'],
        act: ['23a2a8'],
        example: { bad: '<img src="chart.png">', good: '<img src="chart.png" alt="Sales rose 20% in May">' }
    },
    {
        rules: ['input-image-alt'],
        message: 'Image buttons need a text alternative',
        why: 'An <input type="image"> is a button; without alt text screen readers cannot say what it does.',
        fix: 'Add an alt attribute that names the action, not the picture.',
        wcag: ['1.1.1', '4.1.2'],
        act: ['59796f'],
        example: { bad: '<input type="image" src="search.svg">', good: '<input type="image" src="search.svg" alt="Search">' }
    },
    {
        rules: ['area-alt'],
        message: 'Image map areas need a text alternative',
        why: 'Each <area> with an href is a link; without alt text screen readers cannot say where it leads.',
        fix: 'Add an alt attribute to every area that names its destination.',
        wcag: ['2.4.4', '4.1.2'],
        act: ['c487ae'],
        example: {
            bad: '<map name="floors">\n  <area shape="rect" coords="0,0,80,40" href="/floor-1">\n</map>',
            good: '<map name="floors">\n  <area shape="rect" coords="0,0,80,40" href="/floor-1" alt="First floor">\n</map>'
        }
    },
    {
        rules: ['object-alt'],
        message: '<object> elements need a text alternative',
        why: 'Screen readers cannot describe the content an <object> embeds unless it has an accessible name.',
        fix: 'Name the object with aria-label, aria-labelledby or title.',
        wcag: ['1.1.1'],
        act: ['8fc3b6'],
        example: {
            bad: '<object data="org-chart.svg" type="image/svg+xml"></object>',
            good: '<object data="org-chart.svg" type="image/svg+xml" aria-label="Organisation chart"></object>'
        }
    },
    {
        rules: ['role-img-alt'],
        message: 'Elements with role="img" need a text alternative',
        why: 'An element with role="img" is announced as an image; without a name screen reader users learn nothing about it.',
        fix: 'Name it with aria-label or aria-labelledby.',
        wcag: ['1.1.1'],
        act: ['23a2a8'],
        example: { bad: '<div role="img" class="rating-4"></div>', good: '<div role="img" class="rating-4" aria-label="Rated 4 of 5"></div>' }
    },
    {
        rules: ['svg-img-alt'],
        message: 'SVG images need a text alternative',
        why: 'An <svg> with role="img" is announced as an image; without a name screen reader users learn nothing about it.',
        fix: 'Name it with aria-label, aria-labelledby or a <title> child.',
        wcag: ['1.1.1'],
        act: ['7d6734'],
        example: {
            bad: '<svg role="img" viewBox="0 0 24 24"><path d="M3 12h18"></path></svg>',
            good: '<svg role="img" aria-label="Menu" viewBox="0 0 24 24"><path d="M3 12h18"></path></svg>'
        }
    },
    {
        rules: [...jsx('img-redundant-alt'), svelte('a11y_img_redundant_alt')],
        message: 'Alt text should not say "image" or "picture"',
        why: 'Screen readers already announce the element as an image, so the word is heard twice and adds nothing.',
        fix: 'Describe what the image shows instead.',
        wcag: ['1.1.1'],
        act: ['qt1vmo'],
        example: { bad: '<img src="team.jpg" alt="Image of our team">', good: '<img src="team.jpg" alt="Our team at the summer meetup">' }
    },
    {
        rules: [svelte('a11y_missing_attribute')],
        message: 'Element is missing an attribute it needs to be accessible',
        why: 'Some elements only work for everyone with certain attributes: alt on images, href on links, lang on <html>, title on <iframe>.',
        fix: 'Add the attribute the warning names, with a meaningful value.',
        wcag: ['1.1.1', '2.1.1', '3.1.1', '4.1.2'],
        act: ['23a2a8', 'b5c3f8', 'cae760'],
        example: { bad: '<img src="chart.png">', good: '<img src="chart.png" alt="Sales rose 20% in May">' }
    },

    // Names of links, buttons and headings
    {
        rules: [...jsx('anchor-has-content'), vue('anchor-has-content'), 'link-name'],
        message: 'Links need text that names them',
        why: 'A link without text is announced as just "link", so screen reader users cannot tell where it goes.',
        fix: 'Put visible text in the link, or an aria-label when it only holds an icon.',
        wcag: ['2.4.4', '4.1.2'],
        act: ['c487ae'],
        example: {
            bad: '<a href="/cart"><span class="icon-cart" aria-hidden="true"></span></a>',
            good: '<a href="/cart"><span class="icon-cart" aria-hidden="true"></span> Cart</a>'
        }
    },
    {
        rules: ['button-name', 'input-button-name', 'aria-command-name', 'summary-name', svelte('a11y_consider_explicit_label')],
        message: 'Buttons need text that names them',
        why: 'A button without text is announced as just "button", so screen reader users cannot tell what it does.',
        fix: 'Put visible text in the button, or an aria-label when it only holds an icon; give an input button a value.',
        wcag: ['4.1.2', '2.4.4'],
        act: ['97a4e1', 'm6b1q3', '2t702h'],
        example: {
            bad: '<button type="button"><span class="icon-close"></span></button>',
            good: '<button type="button" aria-label="Close"><span class="icon-close"></span></button>'
        }
    },
    {
        rules: [ng('elements-content')],
        message: 'Links, buttons and headings need text content',
        why: 'Without content these elements are announced without a name, so screen reader users cannot tell what they are for.',
        fix: 'Put text in the element, or an aria-label when it only holds an icon.',
        wcag: ['2.4.4', '4.1.2', '2.4.6', '1.3.1'],
        act: ['c487ae', '97a4e1', 'ffd0e9'],
        example: { bad: '<a href="/cart"></a>', good: '<a href="/cart">Cart</a>' }
    },
    {
        rules: [...jsx('heading-has-content'), vue('heading-has-content'), svelte('a11y_missing_content')],
        message: 'Headings need text content',
        why: 'Screen reader users navigate by headings; an empty heading is a stop that says nothing.',
        fix: 'Put text in the heading, or remove it.',
        wcag: ['2.4.6', '1.3.1'],
        act: ['ffd0e9'],
        example: { bad: '<h2></h2>', good: '<h2>Shipping address</h2>' }
    },
    {
        rules: jsx('anchor-ambiguous-text'),
        message: 'Link text must make sense on its own',
        why: 'Screen reader users often list the links of a page; "click here" or "learn more" says nothing about the destination.',
        fix: 'Name where the link goes or what it does.',
        wcag: ['2.4.4'],
        act: ['5effbb'],
        example: { bad: '<a href="/pricing">Click here</a>', good: '<a href="/pricing">See pricing</a>' }
    },
    {
        rules: [...jsx('anchor-is-valid'), svelte('a11y_invalid_attribute')],
        message: 'Links need a real destination; use a button for actions',
        why: 'A link with href="#" or "javascript:" goes nowhere, is announced as a link though it acts as a button and does not react to the keys a button does.',
        fix: 'Give the link a real URL, or use a <button> for an action.',
        wcag: ['2.1.1'],
        example: { bad: '<a href="#" onclick="openMenu()">Menu</a>', good: '<button type="button" onclick="openMenu()">Menu</button>' }
    },

    {
        rules: [...jsx('iframe-has-title'), vue('iframe-has-title'), htmlEslint('require-frame-title'), 'frame-title'],
        message: 'Frames need a title',
        why: 'Screen readers announce a frame by its title; without one users cannot tell what the frame holds before entering it.',
        fix: 'Add a title that describes the frame\'s content.',
        wcag: ['4.1.2'],
        act: ['cae760'],
        example: { bad: '<iframe src="https://maps.example.com/shop"></iframe>', good: '<iframe src="https://maps.example.com/shop" title="Map to our shop"></iframe>' }
    },
    {
        rules: ['frame-title-unique'],
        message: 'Frames need distinct titles',
        why: 'Frames with the same title sound identical, so screen reader users cannot tell them apart.',
        fix: 'Give each frame a title that names its own content.',
        wcag: ['4.1.2'],
        act: ['4b1c6c'],
        example: {
            bad: '<div>\n  <iframe src="/videos/setup" title="Video"></iframe>\n  <iframe src="/videos/cleaning" title="Video"></iframe>\n</div>',
            good: '<div>\n  <iframe src="/videos/setup" title="Video: setting up"></iframe>\n  <iframe src="/videos/cleaning" title="Video: cleaning"></iframe>\n</div>'
        }
    },

    // Keyboard
    {
        rules: [...jsx('click-events-have-key-events'), vue('click-events-have-key-events'), ng('click-events-have-key-events'), svelte('a11y_click_events_have_key_events')],
        message: 'Click handlers need a keyboard equivalent',
        why: 'Keyboard and switch users cannot trigger an action that only listens for mouse clicks.',
        fix: 'Use a <button>, which fires click on Enter and Space; otherwise add a key handler, a role and tabindex="0".',
        wcag: ['2.1.1'],
        example: { bad: '<div onclick="openMenu()">Menu</div>', good: '<button type="button" onclick="openMenu()">Menu</button>' }
    },
    {
        rules: [...jsx('mouse-events-have-key-events'), vue('mouse-events-have-key-events'), ng('mouse-events-have-key-events'), svelte('a11y_mouse_events_have_key_events')],
        message: 'Hover handlers need focus equivalents',
        why: 'What appears on mouseover never appears for keyboard users unless focus does the same.',
        fix: 'Pair mouseover with focus and mouseout with blur.',
        wcag: ['2.1.1'],
        example: {
            bad: '<button type="button" onmouseover="showTip()" onmouseout="hideTip()">Info</button>',
            good: '<button type="button" onmouseover="showTip()" onmouseout="hideTip()" onfocus="showTip()" onblur="hideTip()">Info</button>'
        }
    },
    {
        rules: [...jsx('interactive-supports-focus'), vue('interactive-supports-focus'), ng('interactive-supports-focus'), svelte('a11y_interactive_supports_focus')],
        message: 'Interactive elements must be focusable',
        why: 'An element with a handler and an interactive role that is not in the tab order cannot be reached with the keyboard.',
        fix: 'Use the native element, such as <button>, or add tabindex="0".',
        wcag: ['2.1.1'],
        example: { bad: '<div role="button" onclick="save()">Save</div>', good: '<button type="button" onclick="save()">Save</button>' }
    },
    {
        rules: [...jsx('aria-activedescendant-has-tabindex'), svelte('a11y_aria_activedescendant_has_tabindex')],
        message: 'Elements with aria-activedescendant must be focusable',
        why: 'aria-activedescendant moves the active option while focus stays on the container; a container that cannot take focus cannot be used with the keyboard.',
        fix: 'Add tabindex="0" to the element, unless it is natively focusable.',
        wcag: ['2.1.1'],
        example: {
            bad: '<div role="listbox" aria-label="Colour" aria-activedescendant="red">\n  <div role="option" id="red" aria-selected="true">Red</div>\n</div>',
            good: '<div role="listbox" aria-label="Colour" aria-activedescendant="red" tabindex="0">\n  <div role="option" id="red" aria-selected="true">Red</div>\n</div>'
        }
    },
    {
        rules: [...jsx('tabindex-no-positive'), vue('tabindex-no-positive'), ng('no-positive-tabindex'), svelte('a11y_positive_tabindex'), htmlEslint('no-positive-tabindex')],
        message: 'Do not use a positive tabindex',
        why: 'A tabindex above 0 jumps the element ahead of everything else, so the focus order no longer follows the page.',
        fix: 'Remove the tabindex, or use 0, and order the markup the way it should be read.',
        wcag: ['2.4.3'],
        example: { bad: '<button type="button" tabindex="1">Search</button>', good: '<button type="button">Search</button>' }
    },
    {
        rules: ['frame-focusable-content'],
        message: 'Frames with focusable content must stay in the tab order',
        why: 'tabindex="-1" on an <iframe> keeps keyboard users from reaching the controls inside it.',
        fix: 'Remove the negative tabindex from the frame.',
        wcag: ['2.1.1'],
        act: ['akn7bn'],
        example: {
            bad: '<iframe src="/booking-form" title="Booking form" tabindex="-1"></iframe>',
            good: '<iframe src="/booking-form" title="Booking form"></iframe>'
        }
    },
    {
        rules: ['server-side-image-map'],
        message: 'Do not use server-side image maps',
        why: 'An ismap image only reacts to mouse click coordinates, so keyboard users cannot choose a region.',
        fix: 'Use a client-side image map with <area> links, or plain links.',
        wcag: ['2.1.1'],
        example: {
            bad: '<a href="/stores"><img src="map.png" alt="Store map" ismap></a>',
            good: '<div>\n  <img src="map.png" alt="Store map" usemap="#stores">\n  <map name="stores">\n    <area shape="rect" coords="0,0,80,40" href="/stores/berlin" alt="Berlin">\n  </map>\n</div>'
        }
    },

    // Roles, states and properties
    {
        rules: [
            ...jsx('aria-props'), ...jsx('aria-proptypes'), vue('aria-props'), ng('valid-aria'), 'aria-valid-attr', 'aria-valid-attr-value',
            svelte('a11y_unknown_aria_attribute'), svelte('a11y_incorrect_aria_attribute_type'),
            ...['boolean', 'id', 'idlist', 'integer', 'token', 'tokenlist', 'tristate'].map(type => svelte(`a11y_incorrect_aria_attribute_type_${type}`))
        ],
        message: 'ARIA attributes must exist and have valid values',
        why: 'Assistive technology ignores a misspelled ARIA attribute or a value of the wrong type, so the state it should convey is lost.',
        fix: 'Fix the spelling and use a value of the type the attribute takes, such as true or false for aria-expanded, or an existing id for aria-controls.',
        wcag: ['4.1.2'],
        act: ['5f99a7', '6a7281'],
        example: {
            bad: '<button type="button" aria-expanded="yes" aria-labeledby="menu-label">Menu</button>',
            good: '<button type="button" aria-expanded="false">Menu</button>'
        }
    },
    {
        rules: [
            ...jsx('aria-role'), vue('aria-role'), 'aria-roles', 'aria-deprecated-role', svelte('a11y_unknown_role'), svelte('a11y_no_abstract_role'),
            htmlEslint('no-abstract-roles')
        ],
        message: 'Roles must be valid, concrete ARIA roles',
        why: 'An unknown, abstract or deprecated role is ignored or misread, so assistive technology cannot tell what the element is.',
        fix: 'Use a non-abstract, non-deprecated role from WAI-ARIA, or a native element that already has the role.',
        wcag: ['4.1.2'],
        act: ['674b10'],
        example: { bad: '<div role="alrt">Saved</div>', good: '<div role="alert">Saved</div>' }
    },
    {
        rules: [...jsx('aria-unsupported-elements'), vue('aria-unsupported-elements'), svelte('a11y_aria_attributes'), svelte('a11y_misplaced_role')],
        message: 'Elements that are never rendered take no role or ARIA attributes',
        why: '<meta>, <html>, <script> and <style> are not exposed to assistive technology, so a role or ARIA attribute on them does nothing.',
        fix: 'Remove the role and aria-* attributes, or move them to the element they were meant for.',
        wcag: ['4.1.2'],
        example: {
            bad: '<meta name="description" content="Handmade shoes" aria-hidden="true">',
            good: '<meta name="description" content="Handmade shoes">'
        },
        overrides: {
            svelte: {
                bad: '<svelte:head>\n  <meta name="description" content="Handmade shoes" aria-hidden="true">\n</svelte:head>',
                good: '<svelte:head>\n  <meta name="description" content="Handmade shoes">\n</svelte:head>'
            }
        }
    },
    {
        rules: [...jsx('role-has-required-aria-props'), vue('role-has-required-aria-props'), ng('role-has-required-aria'), svelte('a11y_role_has_required_aria_props'), 'aria-required-attr'],
        message: 'Roles need their required ARIA states',
        why: 'A custom checkbox without aria-checked, for example, is announced without its state, so users cannot tell whether it is on.',
        fix: 'Add the states the role requires and keep them updated, or use the native element, such as <input type="checkbox">.',
        wcag: ['4.1.2'],
        act: ['4e8ab6'],
        example: {
            bad: '<div role="checkbox" tabindex="0">Remember me</div>',
            good: '<div role="checkbox" aria-checked="false" tabindex="0">Remember me</div>'
        }
    },
    {
        rules: [...jsx('role-supports-aria-props'), svelte('a11y_role_supports_aria_props'), svelte('a11y_role_supports_aria_props_implicit'), 'aria-allowed-attr', 'aria-conditional-attr'],
        message: "Use only ARIA attributes the element's role supports",
        why: 'An ARIA attribute the role does not support is ignored or contradicts the element, so users get a wrong or no state.',
        fix: 'Remove the attribute, use one the role supports, or change the role.',
        wcag: ['4.1.2'],
        act: ['5c01ea'],
        example: { bad: '<a href="/cart" aria-checked="true">Cart</a>', good: '<a href="/cart" aria-current="page">Cart</a>' }
    },
    {
        rules: ['aria-prohibited-attr'],
        message: 'This element cannot be named with aria-label',
        why: 'Roles such as generic (a plain div or span), paragraph and presentation cannot be named, so screen readers ignore aria-label and aria-labelledby on them.',
        fix: 'Put the text in the content, or give the element a role that can be named.',
        wcag: ['4.1.2'],
        act: ['kb1m8s'],
        example: { bad: '<span class="badge" aria-label="New"></span>', good: '<span class="badge">New</span>' }
    },
    {
        rules: ['aria-required-children'],
        message: 'ARIA roles must contain the children they require',
        why: 'A list, menu or tablist without its items is announced as empty or wrong, so users cannot use what it holds.',
        fix: 'Give the children the roles the parent role requires, such as listitem in a list.',
        wcag: ['1.3.1'],
        act: ['bc4a75'],
        example: {
            bad: '<div role="list">\n  <span>Apples</span>\n</div>',
            good: '<div role="list">\n  <span role="listitem">Apples</span>\n</div>'
        }
    },
    {
        rules: ['aria-required-parent'],
        message: 'ARIA roles must sit in the parent they require',
        why: 'A tab outside a tablist or an option outside a listbox loses its context, so assistive technology cannot convey the group.',
        fix: 'Wrap the element in an element with the required parent role.',
        wcag: ['1.3.1'],
        act: ['ff89c9'],
        example: {
            bad: '<div role="tab" aria-selected="true">Profile</div>',
            good: '<div role="tablist">\n  <div role="tab" aria-selected="true">Profile</div>\n</div>'
        }
    },
    {
        rules: ['aria-roledescription'],
        message: 'aria-roledescription needs an element with a semantic role',
        why: 'A role description replaces how the role is announced; on an element without a role assistive technology has nothing to describe.',
        fix: 'Use it only on an element with a role, such as a named <section> or role="group".',
        wcag: ['4.1.2'],
        example: {
            bad: '<div aria-roledescription="slide">Spring collection</div>',
            good: '<section aria-roledescription="slide" aria-label="Spring collection">Spring collection</section>'
        }
    },
    {
        rules: ['aria-braille-equivalent'],
        message: 'Braille labels need a matching text label',
        why: 'aria-braillelabel and aria-brailleroledescription only change the braille output; speech users still need aria-label or aria-roledescription.',
        fix: 'Add the non-braille equivalent: an accessible name for aria-braillelabel, aria-roledescription for aria-brailleroledescription.',
        wcag: ['4.1.2'],
        example: {
            bad: '<button type="button" aria-braillelabel="save"><span class="icon-save"></span></button>',
            good: '<button type="button" aria-label="Save" aria-braillelabel="save"><span class="icon-save"></span></button>'
        }
    },
    {
        rules: [...jsx('no-aria-hidden-on-focusable'), vue('no-aria-hidden-on-focusable'), 'aria-hidden-focus'],
        message: 'Hidden content must not be focusable',
        why: 'aria-hidden removes an element from screen readers, but keyboard focus can still land on it, so users reach a control that is announced as nothing.',
        fix: 'Remove aria-hidden, or also take the element out of the tab order, for example with inert or hidden.',
        wcag: ['4.1.2'],
        act: ['6cfa84'],
        example: { bad: '<a href="/home" aria-hidden="true">Home</a>', good: '<a href="/home">Home</a>' }
    },
    {
        rules: [vue('no-role-presentation-on-focusable')],
        message: 'Focusable elements must not be marked presentational',
        why: 'role="presentation" or "none" removes the meaning of an element that keyboard users can still focus and operate.',
        fix: 'Remove the role, or make the element not focusable when it really is decorative.',
        wcag: ['4.1.2'],
        act: ['46ca7f'],
        example: { bad: '<button type="button" role="presentation">Close</button>', good: '<button type="button">Close</button>' }
    },
    {
        rules: [htmlEslint('no-aria-hidden-body'), 'aria-hidden-body'],
        message: 'Do not hide the page body from assistive technology',
        why: 'aria-hidden="true" on <body> hides the whole page from screen readers.',
        fix: 'Remove aria-hidden from <body>; hide only the content behind a modal, for example with inert.',
        wcag: ['1.3.1', '4.1.2'],
        document: true,
        example: { bad: '<body aria-hidden="true">\n  <main>…</main>\n</body>', good: '<body>\n  <main>…</main>\n</body>' }
    },
    {
        rules: [
            ...jsx('no-static-element-interactions'), vue('no-static-element-interactions'), svelte('a11y_no_static_element_interactions')
        ],
        message: 'Elements with handlers need a role',
        why: 'A div or span with a click handler has no role, so assistive technology does not announce it as something to operate.',
        fix: 'Use a native control such as <button>, or give the element a role, tabindex and keyboard handling.',
        wcag: ['4.1.2'],
        example: { bad: '<span onclick="toggle()">Details</span>', good: '<button type="button" onclick="toggle()">Details</button>' }
    },
    {
        rules: [...jsx('no-noninteractive-element-interactions'), svelte('a11y_no_noninteractive_element_interactions')],
        message: 'Non-interactive elements should not handle user input',
        why: 'A list item or heading with a click handler is announced as content, so users do not know they can operate it.',
        fix: 'Put a <button> or link inside the element and handle the input there.',
        wcag: ['4.1.2'],
        example: { bad: '<li onclick="choose()">Red</li>', good: '<li><button type="button" onclick="choose()">Red</button></li>' }
    },
    {
        rules: [...jsx('no-interactive-element-to-noninteractive-role'), svelte('a11y_no_interactive_element_to_noninteractive_role')],
        message: 'Interactive elements must keep an interactive role',
        why: 'A button given a non-interactive role, such as heading, is no longer announced as something to operate.',
        fix: 'Remove the role, and wrap the control in the element whose meaning you wanted.',
        wcag: ['4.1.2'],
        example: {
            bad: '<button type="button" role="heading" aria-level="2">Settings</button>',
            good: '<h2><button type="button">Settings</button></h2>'
        }
    },
    {
        rules: [...jsx('no-noninteractive-element-to-interactive-role'), svelte('a11y_no_noninteractive_element_to_interactive_role')],
        message: 'Non-interactive elements must not take an interactive role',
        why: 'A heading or list item with role="button" loses its own meaning and still lacks the keyboard behaviour of a real button.',
        fix: 'Put a native control inside the element instead.',
        wcag: ['4.1.2'],
        example: { bad: '<h3 role="button">Shipping</h3>', good: '<h3><button type="button">Shipping</button></h3>' }
    },
    {
        rules: [htmlEslint('no-nested-interactive'), 'nested-interactive'],
        message: 'Interactive controls must not be nested',
        why: 'A button inside a link is hidden from screen readers or announced confusingly, and it is unclear which one a click or Enter triggers.',
        fix: 'Place the controls side by side.',
        wcag: ['4.1.2'],
        act: ['307n5z'],
        example: {
            bad: '<a href="/post/42">Read post <button type="button">Like</button></a>',
            good: '<div>\n  <a href="/post/42">Read post</a>\n  <button type="button">Like</button>\n</div>'
        }
    },
    {
        rules: ['duplicate-id-aria'],
        message: 'IDs that ARIA and labels refer to must be unique',
        why: 'When two elements share an id, aria-describedby, aria-labelledby or a label points at the first one only, so the other text is lost or the wrong one is read.',
        fix: 'Give every referenced element its own id.',
        wcag: ['4.1.2'],
        example: {
            bad: '<div>\n  <label for="pw">Password</label>\n  <input type="password" id="pw" aria-describedby="hint">\n  <p id="hint">At least 12 characters</p>\n  <p id="hint">Optional</p>\n</div>',
            good: '<div>\n  <label for="pw">Password</label>\n  <input type="password" id="pw" aria-describedby="pw-hint">\n  <p id="pw-hint">At least 12 characters</p>\n  <p id="note">Optional</p>\n</div>'
        }
    },

    // Forms
    {
        rules: [
            ...jsx('label-has-associated-control'), vue('label-has-for'), vue('form-control-has-label'), ng('label-has-associated-control'),
            svelte('a11y_label_has_associated_control'), 'label', 'select-name'
        ],
        message: 'Form fields need a label tied to them',
        why: 'Screen readers announce a field by its label; a label that is not tied to the field leaves it unnamed, and clicking the label does not focus it.',
        fix: 'Nest the field in its <label>, or set the label\'s for attribute to the field\'s id; doing both is the most robust.',
        wcag: ['1.3.1', '4.1.2'],
        act: ['e086e5'],
        example: {
            bad: '<div>\n  <label>Email</label>\n  <input type="email">\n</div>',
            good: '<label for="email">Email <input type="email" id="email"></label>'
        }
    },
    {
        rules: ['aria-input-field-name', 'aria-toggle-field-name', 'aria-meter-name', 'aria-progressbar-name', 'aria-tooltip-name', 'aria-tab-name'],
        message: 'ARIA widgets need an accessible name',
        why: 'A custom field, switch, meter, progress bar, tab or tooltip without a name is announced only by its role, so users cannot tell what it is for.',
        fix: 'Name it with aria-label or aria-labelledby, or with visible text content where the role allows.',
        wcag: ['4.1.2', '1.1.1'],
        act: ['e086e5'],
        example: {
            bad: '<div role="switch" aria-checked="false" tabindex="0"></div>',
            good: '<div role="switch" aria-checked="false" tabindex="0" aria-label="Dark mode"></div>'
        }
    },
    {
        rules: ['form-field-multiple-labels'],
        message: 'Form fields must not have more than one label',
        why: 'Screen readers announce only one of several labels, or read them inconsistently, so part of the instructions is lost.',
        fix: 'Keep one <label> and tie extra instructions with aria-describedby.',
        wcag: ['3.3.2'],
        example: {
            bad: '<div>\n  <label for="qty">Quantity</label>\n  <label for="qty">Up to 10</label>\n  <input type="number" id="qty">\n</div>',
            good: '<div>\n  <label for="qty">Quantity</label>\n  <input type="number" id="qty" aria-describedby="qty-hint">\n  <p id="qty-hint">Up to 10</p>\n</div>'
        }
    },
    {
        rules: ['label-content-name-mismatch'],
        message: 'The accessible name must contain the visible label',
        why: 'Speech input users say what they see; when aria-label replaces the visible text with other words, the command does not match.',
        fix: 'Start the accessible name with the visible text, or drop the aria-label.',
        wcag: ['2.5.3'],
        act: ['2ee8b8'],
        example: { bad: '<button type="button" aria-label="Submit form">Send</button>', good: '<button type="button">Send</button>' }
    },
    {
        rules: [...jsx('autocomplete-valid'), svelte('a11y_autocomplete_valid'), 'autocomplete-valid', own('autocomplete-valid')],
        message: 'autocomplete must use a valid autofill value',
        why: 'Browsers and assistive technology use the autofill token to fill in and identify fields about the user, which helps people with memory, cognitive or motor impairments.',
        fix: 'Use a token from the HTML standard, such as email, given-name, tel or shipping postal-code.',
        wcag: ['1.3.5'],
        act: ['73f2c2'],
        example: {
            bad: '<label>Email <input type="email" autocomplete="mail"></label>',
            good: '<label>Email <input type="email" autocomplete="email"></label>'
        }
    },
    {
        rules: [own('password-autocomplete')],
        message: 'Password fields must let password managers fill them',
        why: 'Logging in must not depend on remembering or retyping a password; autocomplete="off" keeps password managers out.',
        fix: 'Use autocomplete="current-password" on a login form, or "new-password" where the password is chosen.',
        wcag: ['3.3.8'],
        example: {
            bad: '<label>Password <input type="password" autocomplete="off"></label>',
            good: '<label>Password <input type="password" autocomplete="current-password"></label>'
        }
    },

    // Structure
    {
        rules: [...jsx('scope'), ng('table-scope'), svelte('a11y_misplaced_scope')],
        message: 'scope belongs on <th> only',
        why: 'scope tells assistive technology which cells a header applies to; on a data cell it is ignored, so the header relationship is lost.',
        fix: 'Make the cell a <th>, or remove scope.',
        wcag: ['1.3.1'],
        example: {
            bad: '<table>\n  <tbody>\n    <tr><td scope="row">Total</td><td>42</td></tr>\n  </tbody>\n</table>',
            good: '<table>\n  <tbody>\n    <tr><th scope="row">Total</th><td>42</td></tr>\n  </tbody>\n</table>'
        }
    },
    {
        rules: ['td-has-header'],
        message: 'Data cells in larger tables need headers',
        why: 'Without header cells screen reader users hear values without knowing which row or column they belong to.',
        fix: 'Mark the header row or column with <th> and scope.',
        wcag: ['1.3.1'],
        example: {
            bad: '<table>\n  <tbody>\n    <tr><td>Name</td><td>Price</td><td>Stock</td></tr>\n    <tr><td>Boots</td><td>€90</td><td>12</td></tr>\n    <tr><td>Sandals</td><td>€40</td><td>30</td></tr>\n  </tbody>\n</table>',
            good: '<table>\n  <thead>\n    <tr><th scope="col">Name</th><th scope="col">Price</th><th scope="col">Stock</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>Boots</td><td>€90</td><td>12</td></tr>\n    <tr><td>Sandals</td><td>€40</td><td>30</td></tr>\n  </tbody>\n</table>'
        }
    },
    {
        rules: ['td-headers-attr'],
        message: 'headers must refer to header cells in the same table',
        why: 'A headers attribute that points at a missing id leaves the cell without its header for screen reader users.',
        fix: 'Use the ids of <th> cells in the same table.',
        wcag: ['1.3.1'],
        act: ['a25f45'],
        example: {
            bad: '<table>\n  <tbody>\n    <tr><th id="price">Price</th></tr>\n    <tr><td headers="cost">€90</td></tr>\n  </tbody>\n</table>',
            good: '<table>\n  <tbody>\n    <tr><th id="price">Price</th></tr>\n    <tr><td headers="price">€90</td></tr>\n  </tbody>\n</table>'
        }
    },
    {
        rules: ['th-has-data-cells'],
        message: 'Table headers must have data cells',
        why: 'A header with no cells under it suggests structure that is not there and confuses table navigation.',
        fix: 'Add the missing data cells, or remove the header.',
        wcag: ['1.3.1'],
        act: ['d0f69e'],
        example: {
            bad: '<table>\n  <tbody>\n    <tr><th>Name</th><th>Price</th><th>Notes</th></tr>\n    <tr><td>Boots</td><td>€90</td></tr>\n  </tbody>\n</table>',
            good: '<table>\n  <tbody>\n    <tr><th>Name</th><th>Price</th><th>Notes</th></tr>\n    <tr><td>Boots</td><td>€90</td><td>Waterproof</td></tr>\n  </tbody>\n</table>'
        }
    },
    {
        rules: ['table-fake-caption'],
        message: 'Use <caption> for a table caption, not a cell',
        why: 'A first row with one cell spanning the table looks like a caption but is read as data, and the table is left without a name.',
        fix: 'Move the text into a <caption> element.',
        wcag: ['1.3.1'],
        example: {
            bad: '<table>\n  <tbody>\n    <tr><td colspan="2">Prices</td></tr>\n    <tr><th>Item</th><th>Price</th></tr>\n    <tr><td>Boots</td><td>€90</td></tr>\n  </tbody>\n</table>',
            good: '<table>\n  <caption>Prices</caption>\n  <tbody>\n    <tr><th>Item</th><th>Price</th></tr>\n    <tr><td>Boots</td><td>€90</td></tr>\n  </tbody>\n</table>'
        }
    },
    {
        rules: [htmlEslint('require-li-container'), 'list', 'listitem'],
        message: 'List items belong in a list, and lists hold only list items',
        why: 'Screen readers announce a list and its number of items only when <li> sits directly in <ul> or <ol>.',
        fix: 'Put <li> elements directly in a <ul> or <ol>, and nothing else but <script> or <template>.',
        wcag: ['1.3.1'],
        example: { bad: '<div>\n  <li>Apples</li>\n  <li>Pears</li>\n</div>', good: '<ul>\n  <li>Apples</li>\n  <li>Pears</li>\n</ul>' }
    },
    {
        rules: ['definition-list', 'dlitem'],
        message: 'Description lists hold only <dt> and <dd> groups',
        why: 'Assistive technology conveys the term and description pairs of a <dl> only when its structure is valid.',
        fix: 'Put <dt> and <dd> directly in <dl>, or in a <div> inside it.',
        wcag: ['1.3.1'],
        example: { bad: '<dl>\n  <p>Size</p>\n  <dd>Large</dd>\n</dl>', good: '<dl>\n  <dt>Size</dt>\n  <dd>Large</dd>\n</dl>' }
    },
    {
        rules: [svelte('a11y_figcaption_parent'), svelte('a11y_figcaption_index')],
        message: '<figcaption> must be the first or last child of a <figure>',
        why: 'Only a figcaption in that place captions the figure for assistive technology.',
        fix: 'Move the <figcaption> into its <figure>, as the first or last child.',
        wcag: ['1.3.1'],
        example: {
            bad: '<figure>\n  <img src="bridge.jpg" alt="Golden Gate Bridge at dusk">\n  <figcaption>San Francisco, 2024</figcaption>\n  <p>Photo: A. Lee</p>\n</figure>',
            good: '<figure>\n  <img src="bridge.jpg" alt="Golden Gate Bridge at dusk">\n  <p>Photo: A. Lee</p>\n  <figcaption>San Francisco, 2024</figcaption>\n</figure>'
        }
    },
    {
        rules: ['p-as-heading'],
        message: 'Use heading elements for headings, not styled paragraphs',
        why: 'Bold or large text looks like a heading but screen reader users cannot find it with heading navigation.',
        fix: 'Use <h1> to <h6> at the right level and style them as needed.',
        wcag: ['1.3.1'],
        example: { bad: '<p><b>Shipping</b></p>', good: '<h2>Shipping</h2>' }
    },
    {
        rules: ['bypass'],
        message: 'Pages need a way to skip repeated blocks',
        why: 'Keyboard and screen reader users otherwise go through the whole navigation on every page before reaching the content.',
        fix: 'Add a <main> landmark, a skip link to it, or headings that start the content.',
        wcag: ['2.4.1'],
        act: ['cf77f2'],
        example: {
            bad: '<div>\n  <div class="nav">…</div>\n  <div class="content">…</div>\n</div>',
            good: '<div>\n  <a href="#main">Skip to content</a>\n  <nav>…</nav>\n  <main id="main">…</main>\n</div>'
        }
    },

    // Page
    {
        rules: [...jsx('html-has-lang'), htmlEslint('require-lang'), 'html-has-lang'],
        message: 'The page needs a lang attribute',
        why: 'Screen readers pick the pronunciation from the page language; without it text may be read with the wrong voice and rules.',
        fix: 'Add lang with the main language of the page to <html>.',
        wcag: ['3.1.1'],
        act: ['b5c3f8'],
        document: true,
        example: { bad: '<html>\n  <body>…</body>\n</html>', good: '<html lang="en">\n  <body>…</body>\n</html>' }
    },
    {
        rules: [...jsx('lang'), 'html-lang-valid', 'html-xml-lang-mismatch'],
        message: 'The page language must be a valid language tag',
        why: 'Screen readers only switch pronunciation for a lang value they recognise.',
        fix: 'Use a BCP 47 tag such as "en" or "de-CH"; when xml:lang is set too, give it the same language.',
        wcag: ['3.1.1'],
        act: ['bf051a', '5b7ae0'],
        document: true,
        example: { bad: '<html lang="english">\n  <body>…</body>\n</html>', good: '<html lang="en">\n  <body>…</body>\n</html>' }
    },
    {
        rules: ['valid-lang'],
        message: 'lang must be a valid language tag',
        why: 'Screen readers only switch pronunciation for a passage in another language when its lang value is one they recognise.',
        fix: 'Use a BCP 47 tag such as "de" or "fr-CA".',
        wcag: ['3.1.2'],
        act: ['de46e4'],
        example: { bad: '<p lang="deutsch">Guten Tag</p>', good: '<p lang="de">Guten Tag</p>' }
    },
    {
        rules: ['document-title'],
        message: 'The page needs a title',
        why: 'The title is the first thing a screen reader announces and what identifies the page in tabs and history.',
        fix: 'Add a <title> to <head> that describes the page.',
        wcag: ['2.4.2'],
        act: ['2779a5'],
        document: true,
        example: {
            bad: '<head>\n  <meta charset="utf-8">\n</head>',
            good: '<head>\n  <meta charset="utf-8">\n  <title>Checkout – Shoe Shop</title>\n</head>'
        }
    },
    {
        rules: [htmlEslint('no-non-scalable-viewport'), 'meta-viewport'],
        message: 'Do not disable zooming',
        why: 'user-scalable=no or a low maximum-scale keeps people with low vision from enlarging text on mobile devices.',
        fix: 'Remove user-scalable=no and maximum-scale from the viewport meta tag.',
        wcag: ['1.4.4'],
        act: ['b4f0c3'],
        document: true,
        example: {
            bad: '<meta name="viewport" content="width=device-width, user-scalable=no">',
            good: '<meta name="viewport" content="width=device-width, initial-scale=1">'
        }
    },
    {
        rules: ['meta-refresh'],
        message: 'Do not refresh or redirect the page on a timer',
        why: 'A timed refresh moves people away before they have finished reading or using the page, and resets screen reader focus.',
        fix: 'Remove the timed refresh; redirect on the server or immediately (delay 0), or let users reload themselves.',
        wcag: ['2.2.1'],
        act: ['bc659a'],
        document: true,
        example: {
            bad: '<meta http-equiv="refresh" content="30">',
            good: '<meta http-equiv="refresh" content="0; url=/new-page">'
        }
    },

    // Media and motion
    {
        rules: [...jsx('media-has-caption'), vue('media-has-caption'), svelte('a11y_media_has_caption'), 'video-caption'],
        message: 'Video needs captions',
        why: 'Deaf and hard of hearing people miss the speech and sounds of a video without captions.',
        fix: 'Add a <track kind="captions"> with a caption file.',
        wcag: ['1.2.2'],
        act: ['f51b46', 'eac66b'],
        example: {
            bad: '<video src="intro.mp4" controls></video>',
            good: '<video src="intro.mp4" controls>\n  <track kind="captions" src="intro.en.vtt" srclang="en" label="English">\n</video>'
        }
    },
    {
        rules: ['audio-caption'],
        message: 'Audio needs a text alternative',
        why: 'Deaf and hard of hearing people cannot follow prerecorded audio without a transcript or captions.',
        fix: 'Provide a transcript next to the audio, or a captions track.',
        wcag: ['1.2.1'],
        act: ['e7aa44'],
        example: {
            bad: '<audio src="episode-12.mp3" controls></audio>',
            good: '<div>\n  <audio src="episode-12.mp3" controls></audio>\n  <a href="/episode-12/transcript">Read the transcript</a>\n</div>'
        }
    },
    {
        rules: ['no-autoplay-audio'],
        message: 'Media must not play sound automatically',
        why: 'Sound that starts by itself drowns out screen readers and is hard to stop for people who rely on them.',
        fix: 'Remove autoplay, mute the media, or keep the sound under 3 seconds with a control to stop it.',
        wcag: ['1.4.2'],
        act: ['80f0bf'],
        example: { bad: '<video src="promo.mp4" autoplay></video>', good: '<video src="promo.mp4" controls></video>' }
    },
    {
        rules: [...jsx('no-distracting-elements'), vue('no-distracting-elements'), ng('no-distracting-elements'), svelte('a11y_distracting_elements'), 'blink', 'marquee'],
        message: 'Do not use <marquee> or <blink>',
        why: 'Moving or blinking text that cannot be paused distracts people with attention or reading difficulties and is hard to read.',
        fix: 'Use static text; if something must move, give users a way to pause it.',
        wcag: ['2.2.2'],
        example: { bad: '<marquee>Summer sale!</marquee>', good: '<p>Summer sale!</p>' }
    },
    {
        rules: ['css-orientation-lock'],
        message: 'Do not lock the page to one orientation',
        why: 'People with a device mounted in a fixed orientation, for example on a wheelchair, cannot rotate it to use the page.',
        fix: 'Let the layout adapt to both orientations instead of rotating the page with a transform.',
        wcag: ['1.3.4'],
        act: ['b33eff'],
        example: {
            bad: '<style>\n  @media (orientation: portrait) {\n    body { transform: rotate(90deg); }\n  }\n</style>',
            good: '<style>\n  @media (orientation: portrait) {\n    .gallery { grid-template-columns: 1fr; }\n  }\n</style>'
        },
        overrides: Object.fromEntries((['jsx', 'vue', 'svelte', 'angular', 'astro'] as const).map(framework => [framework, {
            language: 'css',
            file: 'styles.css',
            bad: '@media (orientation: portrait) {\n  body { transform: rotate(90deg); }\n}',
            good: '@media (orientation: portrait) {\n  .gallery { grid-template-columns: 1fr; }\n}'
        }]))
    },
    {
        rules: ['avoid-inline-spacing'],
        message: 'Inline text spacing must stay adjustable',
        why: 'People with dyslexia or low vision override letter, word and line spacing with their own styles; !important in a style attribute blocks that.',
        fix: 'Remove !important from letter-spacing, word-spacing and line-height in style attributes.',
        wcag: ['1.4.12'],
        act: ['24afc2', '78fd32', '9e45ec'],
        example: { bad: '<p style="letter-spacing: 0.05em !important">Terms</p>', good: '<p style="letter-spacing: 0.05em">Terms</p>' },
        overrides: {
            // A React style object cannot carry !important; setProperty can
            jsx: {
                bad: "<p ref={p => p?.style.setProperty('letter-spacing', '0.05em', 'important')}>Terms</p>",
                good: "<p style={{ letterSpacing: '0.05em' }}>Terms</p>"
            }
        }
    },

    // Contrast
    {
        rules: [own('text-contrast')],
        message: 'Text needs enough contrast with its background',
        why: 'Low-contrast text is hard or impossible to read for people with low vision or colour deficiencies, and for anyone in bright light.',
        fix: 'Darken the text or lighten the background (or the other way round) until the ratio reaches 4.5:1, or 3:1 for large text (24 px, or 18.66 px bold).',
        wcag: ['1.4.3'],
        act: ['afw4f7'],
        details: true,
        example: {
            bad: '<p style="color: #999999; background-color: #ffffff">Free returns</p>',
            good: '<p style="color: #595959; background-color: #ffffff">Free returns</p>'
        }
    },
    {
        rules: [own('non-text-contrast')],
        message: 'Text field boundaries need enough contrast',
        why: 'People with low vision cannot find a field whose border and background barely differ from what surrounds it.',
        fix: 'Give the border, or the field\'s background, a contrast of at least 3:1 against the surrounding background.',
        wcag: ['1.4.11'],
        details: true,
        example: {
            bad: '<input type="text" aria-label="Search" style="border: 1px solid #dddddd; background-color: #ffffff">',
            good: '<input type="text" aria-label="Search" style="border: 1px solid #767676; background-color: #ffffff">'
        }
    }
];
