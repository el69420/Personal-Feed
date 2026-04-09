// profile-engine.js — Avatar SVG renderer, colour palettes, and editor definitions.
// Pure functions; no external dependencies.

export const PROF_SKIN = {
    light:        '#FFE4C8',
    medium_light: '#F5C8A0',
    medium:       '#D4956A',
    medium_dark:  '#A0603A',
    dark:         '#5C3520',
};

export const PROF_HAIR_COLOR = {
    black:      '#1A1A1A',
    dark_brown: '#2E1B0E',
    brown:      '#6B3A2A',
    blonde:     '#D4A840',
    ginger:     '#B83A10',
    red:        '#CC1010',
    maroon:     '#6E0B1A',
    blue:       '#1A38B0',
    purple:     '#6018A8',
    pink:       '#D04090',
    white:      '#EDEDEE',
    grey:       '#8888A0',
};

export const PROF_EYE_COLOR = {
    blue:   '#4060A0',
    green:  '#3A7A40',
    brown:  '#7A4A28',
    hazel:  '#8A6030',
    grey:   '#7A8090',
    amber:  '#C07828',
    violet: '#6040A0',
    red:    '#A01820',
    black:  '#181818',
};

export const PROF_CLOTH_COLOR = {
    grey:       '#7A7A7A',
    navy:       '#1E3280',
    black:      '#282828',
    white:      '#F0F0F0',
    teal:       '#1E7878',
    maroon:     '#6E0B1A',
    olive:      '#506028',
    dusty_pink: '#B86070',
};

// Tabbed editor definition — each tab has sections, each section has a dot-path, type, and options.
// Add new styles by extending options arrays; add new tabs/sections by appending entries here.
export const PROF_EDITOR_TABS = [
    { id: 'face', label: 'Face', sections: [
        { path: 'base.skin', label: 'Skin tone', type: 'swatch', options: [
            { value: 'light',        color: '#FFE4C8', label: 'Light' },
            { value: 'medium_light', color: '#F5C8A0', label: 'Medium light' },
            { value: 'medium',       color: '#D4956A', label: 'Medium' },
            { value: 'medium_dark',  color: '#A0603A', label: 'Medium dark' },
            { value: 'dark',         color: '#5C3520', label: 'Dark' },
        ]},
        { path: 'face.expression', label: 'Expression', type: 'chip', options: [
            { value: 'neutral', label: 'Neutral' },
            { value: 'happy',   label: 'Happy' },
            { value: 'sleepy',  label: 'Sleepy' },
        ]},
    ]},
    { id: 'hair', label: 'Hair', sections: [
        { path: 'hair.style', label: 'Style', type: 'chip', options: [
            { value: 'none',          label: 'None' },
            { value: 'short_straight',label: 'Short' },
            { value: 'bob',           label: 'Bob' },
            { value: 'undercut',      label: 'Undercut' },
            { value: 'wolfcut',       label: 'Wolfcut' },
            { value: 'long_curly',    label: 'Long curly' },
            { value: 'shaggy',        label: 'Shaggy' },
            { value: 'ponytail',      label: 'Ponytail' },
            { value: 'bun',           label: 'Bun' },
        ]},
        { path: 'hair.color', label: 'Colour', type: 'swatch', options: [
            { value: 'black',      color: '#1A1A1A', label: 'Black' },
            { value: 'dark_brown', color: '#2E1B0E', label: 'Dark brown' },
            { value: 'brown',      color: '#6B3A2A', label: 'Brown' },
            { value: 'blonde',     color: '#D4A840', label: 'Blonde' },
            { value: 'ginger',     color: '#B83A10', label: 'Ginger' },
            { value: 'red',        color: '#CC1010', label: 'Red' },
            { value: 'maroon',     color: '#6E0B1A', label: 'Maroon' },
            { value: 'blue',       color: '#1A38B0', label: 'Blue' },
            { value: 'purple',     color: '#6018A8', label: 'Purple' },
            { value: 'pink',       color: '#D04090', label: 'Pink' },
            { value: 'white',      color: '#EDEDEE', label: 'White' },
            { value: 'grey',       color: '#8888A0', label: 'Grey' },
        ]},
    ]},
    { id: 'eyes', label: 'Eyes', sections: [
        { path: 'eyes.color', label: 'Eye colour', type: 'swatch', options: [
            { value: 'blue',   color: '#4060A0', label: 'Blue' },
            { value: 'green',  color: '#3A7A40', label: 'Green' },
            { value: 'brown',  color: '#7A4A28', label: 'Brown' },
            { value: 'hazel',  color: '#8A6030', label: 'Hazel' },
            { value: 'grey',   color: '#7A8090', label: 'Grey' },
            { value: 'amber',  color: '#C07828', label: 'Amber' },
            { value: 'violet', color: '#6040A0', label: 'Violet' },
            { value: 'red',    color: '#A01820', label: 'Red' },
            { value: 'black',  color: '#181818', label: 'Black' },
        ]},
    ]},
    { id: 'accessories', label: 'Accessories', sections: [
        { path: 'glasses.style', label: 'Glasses', type: 'chip', options: [
            { value: 'none',        label: 'None' },
            { value: 'round',       label: 'Round' },
            { value: 'rectangular', label: 'Rectangular' },
        ]},
        { path: 'ears.style', label: 'Ear mods', type: 'chip', options: [
            { value: 'none',       label: 'None' },
            { value: 'stretchers', label: 'Stretched' },
        ]},
        { path: 'piercings', label: 'Face piercings', type: 'multi', options: [
            { value: 'septum',    label: 'Septum' },
            { value: 'nostril_l', label: 'Left nostril' },
            { value: 'nostril_r', label: 'Right nostril' },
        ]},
        { path: 'earrings', label: 'Earrings', type: 'multi', options: [
            { value: 'studs',   label: 'Studs' },
            { value: 'hoops',   label: 'Hoops' },
            { value: 'dangles', label: 'Dangles' },
        ]},
    ]},
    { id: 'extras', label: 'Extras', sections: [
        { path: 'extras', label: 'Extras', type: 'multi', options: [
            { value: 'freckles',     label: 'Freckles' },
            { value: 'heavy_blush',  label: 'Heavy blush' },
            { value: 'eyebrow_slit', label: 'Eyebrow slit' },
        ]},
        { path: 'clothing.style', label: 'Top', type: 'chip', options: [
            { value: 'hoodie',  label: 'Hoodie' },
            { value: 'tshirt',  label: 'T-shirt' },
            { value: 'tank',    label: 'Tank' },
            { value: 'sweater', label: 'Sweater' },
        ]},
        { path: 'clothing.color', label: 'Top colour', type: 'swatch', options: [
            { value: 'grey',       color: '#7A7A7A', label: 'Grey' },
            { value: 'navy',       color: '#1E3280', label: 'Navy' },
            { value: 'black',      color: '#282828', label: 'Black' },
            { value: 'white',      color: '#F0F0F0', label: 'White' },
            { value: 'teal',       color: '#1E7878', label: 'Teal' },
            { value: 'maroon',     color: '#6E0B1A', label: 'Maroon' },
            { value: 'olive',      color: '#506028', label: 'Olive' },
            { value: 'dusty_pink', color: '#B86070', label: 'Dusty pink' },
        ]},
    ]},
];

// User defaults in layered-parts format
export const PROF_DEFAULTS = {
    El: {
        base:      { skin: 'light' },
        ears:      { style: 'none' },
        hair:      { style: 'shaggy', color: 'maroon' },
        face:      { expression: 'neutral' },
        eyes:      { color: 'blue' },
        glasses:   { style: 'none' },
        piercings: ['septum'],
        earrings:  ['studs', 'hoops'],
        extras:    [],
        clothing:  { style: 'hoodie', color: 'navy' },
    },
    Tero: {
        base:      { skin: 'medium_light' },
        ears:      { style: 'none' },
        hair:      { style: 'long_curly', color: 'dark_brown' },
        face:      { expression: 'neutral' },
        eyes:      { color: 'brown' },
        glasses:   { style: 'none' },
        piercings: [],
        earrings:  [],
        extras:    [],
        clothing:  { style: 'tshirt', color: 'teal' },
    },
};

// Migrate old flat avatar data to new layered-parts format.
// Safe to call on already-migrated data (detects by checking base is an object).
export function _migrateAvatarData(data) {
    if (!data) return null;
    if (data.base && typeof data.base === 'object') return data; // already new format
    // Convert old flat format
    const earStyle = data.ear || 'none';
    let ears = { style: 'none' };
    let earrings = [];
    if (earStyle === 'stretchers')  { ears = { style: 'stretchers' }; }
    if (earStyle === 'lobe_studs')  { earrings = ['studs']; }
    if (earStyle === 'hoops')       { earrings = ['hoops']; }
    if (earStyle === 'studs_hoops') { earrings = ['studs', 'hoops']; }
    return {
        base:      { skin: data.skin || 'light' },
        ears,
        hair:      { style: data.hair || 'shaggy', color: data.hair_color || 'maroon' },
        face:      { expression: data.eyes === 'sleepy' ? 'sleepy' : 'neutral' },
        eyes:      { color: 'blue' },
        glasses:   { style: data.glasses || 'none' },
        piercings: Array.isArray(data.face_pierce) ? data.face_pierce : [],
        earrings,
        extras:    [],
        clothing:  { style: data.clothing || 'hoodie', color: data.clothing_color || 'navy' },
    };
}

export function _deepCopyParts(parts) {
    const copy = {};
    for (const k of Object.keys(parts)) {
        if (Array.isArray(parts[k])) copy[k] = [...parts[k]];
        else if (typeof parts[k] === 'object' && parts[k] !== null) copy[k] = Object.assign({}, parts[k]);
        else copy[k] = parts[k];
    }
    return copy;
}

export function _profDarken(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amt)));
    const g = Math.max(0, Math.round(((n >>  8) & 0xff) * (1 - amt)));
    const b = Math.max(0, Math.round(( n        & 0xff) * (1 - amt)));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// ---- Layer drawing functions (each pushes SVG fragments onto `out`) ----

// Base body layer — always rendered beneath clothing.
// Draws neck, upper torso/shoulders, and both upper arms in skin colour so
// they remain visible regardless of which clothing style is chosen.
function _profAvatarBaseBody(skin, skinSh, out) {
    // Neck — rendered before the head ellipse so the chin naturally overlaps it
    out.push(`<path d="M43 68 L42 79 Q50 82 58 79 L57 68Z" fill="${skin}"/>`);
    // Left upper arm — drawn before torso so the shoulder area overlaps the arm top
    out.push(`<path d="M21 79 Q11 87 11 100 L26 100 Q27 92 27 84 Q24 81 21 79Z" fill="${skin}"/>`);
    // Right upper arm
    out.push(`<path d="M79 79 Q89 87 89 100 L74 100 Q73 92 73 84 Q76 81 79 79Z" fill="${skin}"/>`);
    // Torso / shoulders — wide trapezoid connecting neck to lower canvas
    out.push(`<path d="M21 79 Q13 83 13 100 L87 100 Q87 83 79 79 Q67 75 50 77 Q33 75 21 79Z" fill="${skin}"/>`);
    // Collarbone / chest shadow for depth
    out.push(`<path d="M37 79 Q50 76 63 79 Q56 83 50 83 Q44 83 37 79Z" fill="${skinSh}" opacity="0.18"/>`);
    // Arm-edge shading for roundness
    out.push(`<path d="M21 79 Q13 83 11 91 Q14 88 18 88 Q18 84 21 79Z" fill="${skinSh}" opacity="0.2"/>`);
    out.push(`<path d="M79 79 Q87 83 89 91 Q86 88 82 88 Q82 84 79 79Z" fill="${skinSh}" opacity="0.2"/>`);
}

function _profAvatarHairBack(style, H, HD, out) {
    if (style === 'short_straight') {
        // Close-cropped; back layer extends 2 px beyond head edge so sides wrap around
        out.push(`<path d="M26 50 Q22 34 24 22 Q34 15 50 15 Q66 15 76 22 Q78 34 74 50 Q68 44 50 43 Q32 44 26 50Z" fill="${H}"/>`);
    } else if (style === 'bob') {
        // Normalized side anchors to x=28/72 (matches head edge)
        out.push(`<path d="M28 50 Q22 54 22 64 Q22 72 28 73 Q38 75 50 75 Q62 75 72 73 Q78 72 78 64 Q78 54 72 50 Q66 56 50 57 Q34 56 28 50Z" fill="${H}"/>`);
    } else if (style === 'long_curly') {
        out.push(`<path d="M28 24 Q20 30 15 38 Q11 46 13 54 Q9 62 11 70 Q9 78 13 86 Q16 92 24 95 Q36 97 50 97 Q64 97 76 95 Q84 92 87 86 Q89 78 91 70 Q89 62 87 54 Q89 46 85 38 Q80 30 72 24 Q66 28 50 30 Q34 28 28 24Z" fill="${H}"/>`);
    } else if (style === 'shaggy') {
        out.push(`<path d="M26 24 Q16 30 12 40 Q8 50 10 60 Q8 70 12 78 Q14 84 22 86 Q34 88 50 87 Q66 88 78 86 Q86 84 88 78 Q92 70 90 60 Q92 50 88 40 Q84 30 74 24 Q68 28 50 30 Q32 28 26 24Z" fill="${H}"/>`);
    } else if (style === 'ponytail') {
        out.push(`<path d="M53 22 Q58 32 60 48 Q62 64 63 78 Q64 88 60 90 Q56 92 54 84 Q52 70 50 56 Q50 38 50 22 Q51 20 53 22Z" fill="${H}"/>`);
    } else if (style === 'bun') {
        // Hair pulled back; back layer wraps around sides like short_straight
        out.push(`<path d="M26 50 Q22 34 24 22 Q34 15 50 15 Q66 15 76 22 Q78 34 74 50 Q68 44 50 43 Q32 44 26 50Z" fill="${H}"/>`);
    } else if (style === 'undercut') {
        // Shaved sides — only a rounded cap at the crown
        out.push(`<path d="M36 50 Q32 28 50 20 Q68 28 64 50 Q58 44 50 42 Q42 44 36 50Z" fill="${H}"/>`);
    } else if (style === 'wolfcut') {
        // Shoulder-length, layered/choppy silhouette
        out.push(`<path d="M27 26 Q16 34 12 46 Q8 58 10 68 Q8 78 12 86 Q16 92 26 94 Q38 98 50 98 Q62 98 74 94 Q84 92 88 86 Q92 78 90 68 Q92 58 88 46 Q84 34 73 26 Q67 30 50 32 Q33 30 27 26Z" fill="${H}"/>`);
    }
}

function _profAvatarHairFront(style, H, HD, out) {
    if (style === 'none') return;
    if (style === 'short_straight') {
        out.push(`<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q66 44 50 43 Q34 44 28 50Z" fill="${H}"/>`);
    } else if (style === 'bob') {
        out.push(`<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q66 44 50 43 Q34 44 28 50Z" fill="${H}"/>`);
    } else if (style === 'long_curly') {
        out.push(`<path d="M26 38 Q26 18 50 15 Q74 18 74 38 Q68 34 50 32 Q32 34 26 38Z" fill="${H}"/>`);
        out.push(`<path d="M26 38 Q20 46 18 56 Q16 66 18 72 Q20 76 22 72 Q24 64 24 54 Q25 46 26 38Z" fill="${H}"/>`);
        out.push(`<path d="M74 38 Q80 46 82 56 Q84 66 82 72 Q80 76 78 72 Q76 64 76 54 Q75 46 74 38Z" fill="${H}"/>`);
    } else if (style === 'shaggy') {
        out.push(`<path d="M26 24 Q28 18 50 16 Q72 18 74 24 Q70 30 64 33 Q58 36 50 35 Q42 36 36 33 Q30 30 26 24Z" fill="${H}"/>`);
        out.push(`<path d="M26 24 Q20 32 18 44 Q16 54 18 64 Q20 70 22 64 Q24 54 24 44 Q26 36 26 24Z" fill="${H}"/>`);
        out.push(`<path d="M74 24 Q80 32 82 44 Q84 54 82 64 Q80 70 78 64 Q76 54 76 44 Q74 36 74 24Z" fill="${H}"/>`);
    } else if (style === 'ponytail') {
        out.push(`<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q65 42 50 40 Q35 42 28 50Z" fill="${H}"/>`);
        out.push(`<path d="M46 17 Q50 14 54 17 Q54 24 50 26 Q46 24 46 17Z" fill="${HD}"/>`);
    } else if (style === 'bun') {
        out.push(`<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q65 42 50 40 Q35 42 28 50Z" fill="${H}"/>`);
        out.push(`<ellipse cx="50" cy="12" rx="10" ry="9" fill="${H}"/>`);
        out.push(`<ellipse cx="50" cy="12" rx="6" ry="5" fill="${HD}"/>`);
    } else if (style === 'undercut') {
        // Long swept top; sides are closely shaved so no side hair panels
        out.push(`<path d="M36 50 Q32 28 50 20 Q68 28 64 50 Q58 44 50 42 Q42 44 36 50Z" fill="${H}"/>`);
        // Swept top shadow/fold
        out.push(`<path d="M40 32 Q50 20 62 28 Q60 36 54 38 Q48 36 42 36 Q39 34 40 32Z" fill="${HD}"/>`);
    } else if (style === 'wolfcut') {
        // Crown cap
        out.push(`<path d="M28 46 Q26 18 50 14 Q74 18 72 46 Q66 40 50 38 Q34 40 28 46Z" fill="${H}"/>`);
        // Wispy side layers that hang past the ears
        out.push(`<path d="M28 42 Q22 52 20 62 Q22 60 24 56 Q26 50 28 42Z" fill="${H}"/>`);
        out.push(`<path d="M72 42 Q78 52 80 62 Q78 60 76 56 Q74 50 72 42Z" fill="${H}"/>`);
        // Choppy fringe — small dark accents on the top
        out.push(`<path d="M34 36 Q38 24 44 22 Q40 28 38 36Z" fill="${HD}"/>`);
        out.push(`<path d="M66 36 Q62 24 56 22 Q60 28 62 36Z" fill="${HD}"/>`);
        out.push(`<path d="M44 28 Q48 16 52 16 Q56 18 56 28 Q52 26 48 26Z" fill="${H}"/>`);
    }
}

// Clothing overlay — rendered on top of the base body but beneath the head.
// Each style covers only its natural area; the base body arms show through
// where the clothing has no sleeves (tank) or short sleeves (tshirt).
// All torso paths span x=21–79 at shoulder level to match the base body width,
// and necklines are raised to y≈72 to overlap the neck base and prevent gaps.
function _profAvatarClothing(style, C, CS, out) {
    if (style === 'hoodie') {
        // Fitted sleeves — taper from shoulder to wrist
        out.push(`<path d="M21 79 Q11 87 11 100 L26 100 Q27 92 27 84 Q24 81 21 79Z" fill="${C}"/>`);
        out.push(`<path d="M79 79 Q89 87 89 100 L74 100 Q73 92 73 84 Q76 81 79 79Z" fill="${C}"/>`);
        // Torso — full shoulder width (x=21–79), neckline raised to y=72 for overlap
        out.push(`<path d="M21 79 Q13 83 13 100 L87 100 Q87 83 79 79 Q67 73 57 72 Q50 70 43 72 Q33 73 21 79Z" fill="${C}"/>`);
        // Hood-fold / drawstring seam detail at neckline
        out.push(`<path d="M43 72 Q50 70 57 72 L58 78 Q50 80 42 78Z" fill="${CS}"/>`);
    } else if (style === 'tshirt') {
        // Short sleeves — end around mid-upper-arm, leaving forearms in skin
        out.push(`<path d="M21 79 Q11 85 11 93 L26 93 Q27 87 27 83 Q24 81 21 79Z" fill="${C}"/>`);
        out.push(`<path d="M79 79 Q89 85 89 93 L74 93 Q73 87 73 83 Q76 81 79 79Z" fill="${C}"/>`);
        // Torso — full shoulder width, fitted look, neckline raised to y=73
        out.push(`<path d="M21 79 Q14 82 14 100 L86 100 Q86 82 79 79 Q67 74 57 73 Q50 71 43 73 Q33 74 21 79Z" fill="${C}"/>`);
    } else if (style === 'tank') {
        // Shoulder straps only — arms fully visible on both sides
        out.push(`<rect x="39" y="72" width="6" height="9" fill="${C}" rx="2"/>`);
        out.push(`<rect x="55" y="72" width="6" height="9" fill="${C}" rx="2"/>`);
        // Narrow torso — leaves shoulder/arm skin visible on either side
        out.push(`<path d="M39 79 Q33 83 33 100 L67 100 Q67 83 61 79 Q56 74 50 72 Q44 74 39 79Z" fill="${C}"/>`);
    } else if (style === 'sweater') {
        // Baggier sleeves — visually distinct from hoodie's fitted sleeves
        out.push(`<path d="M21 79 Q9 87 8 100 L27 100 Q28 91 28 83 Q25 81 21 79Z" fill="${C}"/>`);
        out.push(`<path d="M79 79 Q91 87 92 100 L73 100 Q72 91 72 83 Q75 81 79 79Z" fill="${C}"/>`);
        // Slightly boxier torso, same full shoulder width and neckline height as hoodie
        out.push(`<path d="M21 79 Q13 83 13 100 L87 100 Q87 83 79 79 Q67 73 57 72 Q50 70 43 72 Q33 73 21 79Z" fill="${C}"/>`);
        // Ribbed crew-neck collar — two rib lines for a knit texture
        out.push(`<path d="M43 72 Q50 70 57 72 L57 77 Q50 79 43 77Z" fill="${CS}"/>`);
        out.push(`<path d="M44 72 Q50 70.5 56 72 L56 74.5 Q50 75.5 44 74.5Z" fill="${CS}" opacity="0.55"/>`);
    } else {
        // Fallback — same as tshirt
        out.push(`<path d="M21 79 Q14 82 14 100 L86 100 Q86 82 79 79 Q67 74 57 73 Q50 71 43 73 Q33 74 21 79Z" fill="${C}"/>`);
    }
}

function _profAvatarEars(skin, skinSh, earMod, out) {
    // Base ear shapes (always rendered)
    out.push(`<ellipse cx="27" cy="48" rx="5" ry="7" fill="${skin}"/>`);
    out.push(`<ellipse cx="73" cy="48" rx="5" ry="7" fill="${skin}"/>`);
    out.push(`<ellipse cx="27" cy="48" rx="3" ry="5" fill="${skinSh}" opacity="0.35"/>`);
    out.push(`<ellipse cx="73" cy="48" rx="3" ry="5" fill="${skinSh}" opacity="0.35"/>`);
    const M = '#C8C8C8', MD = '#909090';
    if (earMod === 'stretchers') {
        out.push(`<circle cx="26" cy="51" r="4.5" fill="${MD}" stroke="${M}" stroke-width="1.2"/>`);
        out.push(`<circle cx="74" cy="51" r="4.5" fill="${MD}" stroke="${M}" stroke-width="1.2"/>`);
        out.push(`<circle cx="26" cy="51" r="2.2" fill="${skin}"/>`);
        out.push(`<circle cx="74" cy="51" r="2.2" fill="${skin}"/>`);
    }
}

// Eyes vary by expression; eyeC is the iris colour hex
function _profAvatarEyes(expression, eyeC, out) {
    const EW = '#FFFFFF', ED = '#303040';
    const eyeD = _profDarken(eyeC, 0.35);
    if (expression === 'sleepy') {
        out.push(`<ellipse cx="42" cy="46" rx="5" ry="4" fill="${EW}"/>`);
        out.push(`<ellipse cx="58" cy="46" rx="5" ry="4" fill="${EW}"/>`);
        out.push(`<circle cx="42" cy="47" r="2.5" fill="${eyeC}"/>`);
        out.push(`<circle cx="58" cy="47" r="2.5" fill="${eyeC}"/>`);
        out.push(`<circle cx="42" cy="47" r="1.2" fill="${ED}"/>`);
        out.push(`<circle cx="58" cy="47" r="1.2" fill="${ED}"/>`);
        // Heavy drooping upper eyelid
        out.push(`<path d="M37 46 Q42 42 47 46" fill="#D4B098"/>`);
        out.push(`<path d="M53 46 Q58 42 63 46" fill="#D4B098"/>`);
    } else {
        // neutral and happy share the same open eye shape
        out.push(`<ellipse cx="42" cy="46" rx="5.5" ry="5.5" fill="${EW}"/>`);
        out.push(`<ellipse cx="58" cy="46" rx="5.5" ry="5.5" fill="${EW}"/>`);
        out.push(`<circle cx="42" cy="46.5" r="3.2" fill="${eyeC}"/>`);
        out.push(`<circle cx="58" cy="46.5" r="3.2" fill="${eyeC}"/>`);
        out.push(`<circle cx="42" cy="46.5" r="1.6" fill="${ED}"/>`);
        out.push(`<circle cx="58" cy="46.5" r="1.6" fill="${ED}"/>`);
        out.push(`<circle cx="43.2" cy="45.0" r="0.9" fill="${EW}"/>`);
        out.push(`<circle cx="59.2" cy="45.0" r="0.9" fill="${EW}"/>`);
        out.push(`<path d="M37 43 Q42 40 47 43" fill="none" stroke="${ED}" stroke-width="1.2" stroke-linecap="round"/>`);
        out.push(`<path d="M53 43 Q58 40 63 43" fill="none" stroke="${ED}" stroke-width="1.2" stroke-linecap="round"/>`);
    }
}

// Face details (nose, mouth, blush) vary by expression
function _profAvatarFaceDetails(skin, skinSh, expression, out) {
    out.push(`<circle cx="47" cy="54" r="1.3" fill="${skinSh}" opacity="0.55"/>`);
    out.push(`<circle cx="53" cy="54" r="1.3" fill="${skinSh}" opacity="0.55"/>`);
    if (expression === 'happy') {
        out.push(`<path d="M42 60 Q50 67 58 60" fill="none" stroke="#B07868" stroke-width="1.5" stroke-linecap="round"/>`);
        out.push(`<ellipse cx="33" cy="54" rx="6" ry="3.5" fill="#FF9090" opacity="0.32"/>`);
        out.push(`<ellipse cx="67" cy="54" rx="6" ry="3.5" fill="#FF9090" opacity="0.32"/>`);
    } else if (expression === 'sleepy') {
        out.push(`<path d="M44 61 Q50 63 56 61" fill="none" stroke="#B07868" stroke-width="1.2" stroke-linecap="round"/>`);
        out.push(`<ellipse cx="33" cy="54" rx="5" ry="2.5" fill="#FF9090" opacity="0.12"/>`);
        out.push(`<ellipse cx="67" cy="54" rx="5" ry="2.5" fill="#FF9090" opacity="0.12"/>`);
    } else {
        out.push(`<path d="M43 60 Q50 65 57 60" fill="none" stroke="#B07868" stroke-width="1.5" stroke-linecap="round"/>`);
        out.push(`<ellipse cx="33" cy="54" rx="5.5" ry="3" fill="#FF9090" opacity="0.18"/>`);
        out.push(`<ellipse cx="67" cy="54" rx="5.5" ry="3" fill="#FF9090" opacity="0.18"/>`);
    }
}

function _profAvatarGlasses(style, out) {
    const S = '#404040';
    if (style === 'round') {
        out.push(`<circle cx="42" cy="46" r="7.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<circle cx="58" cy="46" r="7.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<line x1="49.5" y1="46" x2="50.5" y2="46" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="34.5" y1="43" x2="29"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="65.5" y1="43" x2="71"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
    } else if (style === 'rectangular') {
        out.push(`<rect x="34.5" y="42" width="15" height="9" rx="1.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<rect x="50.5" y="42" width="15" height="9" rx="1.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<line x1="49.5" y1="46" x2="50.5" y2="46" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="34.5" y1="44" x2="29"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="65.5" y1="44" x2="71"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
    }
}

// Earrings are rendered on top of hairFront (layer after hair)
function _profAvatarEarrings(earrings, out) {
    const M = '#C8C8C8', MD = '#909090';
    if (earrings.includes('studs')) {
        out.push(`<circle cx="24" cy="54" r="2"   fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
        out.push(`<circle cx="76" cy="54" r="2"   fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
    }
    if (earrings.includes('hoops')) {
        out.push(`<path d="M22 57 Q17 66 24 69 Q31 66 28 57" fill="none" stroke="${M}" stroke-width="2"/>`);
        out.push(`<path d="M78 57 Q83 66 76 69 Q69 66 72 57" fill="none" stroke="${M}" stroke-width="2"/>`);
    }
    if (earrings.includes('dangles')) {
        out.push(`<line x1="24" y1="54" x2="24" y2="65" stroke="${M}" stroke-width="1.5"/>`);
        out.push(`<circle cx="24" cy="67" r="2" fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
        out.push(`<line x1="76" y1="54" x2="76" y2="65" stroke="${M}" stroke-width="1.5"/>`);
        out.push(`<circle cx="76" cy="67" r="2" fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
    }
}

// Extras rendered on the face surface
function _profAvatarExtras(extras, out) {
    if (extras.includes('freckles')) {
        const f = '#C07850';
        [[36,52],[40,50],[33,55],[62,52],[58,51],[65,53],[38,57],[45,50],[55,50],[60,58]].forEach(([x, y]) => {
            out.push(`<circle cx="${x}" cy="${y}" r="0.9" fill="${f}" opacity="0.6"/>`);
        });
    }
    if (extras.includes('heavy_blush')) {
        out.push(`<ellipse cx="33" cy="54" rx="7" ry="4" fill="#FF6060" opacity="0.28"/>`);
        out.push(`<ellipse cx="67" cy="54" rx="7" ry="4" fill="#FF6060" opacity="0.28"/>`);
    }
    if (extras.includes('eyebrow_slit')) {
        // Thin gap cut through the tail of the right eyebrow
        out.push(`<line x1="44" y1="40.5" x2="46" y2="39" stroke="#404040" stroke-width="1.5" stroke-linecap="round"/>`);
    }
}

// Main renderer — accepts new layered-parts format or old flat format (auto-migrated)
export function buildAvatarSVG(rawParts) {
    const p = _migrateAvatarData(rawParts) || _deepCopyParts(PROF_DEFAULTS.El);

    const skin    = PROF_SKIN[p.base?.skin]         || PROF_SKIN.light;
    const skinSh  = _profDarken(skin, 0.15);
    const hairC   = PROF_HAIR_COLOR[p.hair?.color]  || PROF_HAIR_COLOR.brown;
    const hairSh  = _profDarken(hairC, 0.22);
    const clothC  = PROF_CLOTH_COLOR[p.clothing?.color] || PROF_CLOTH_COLOR.grey;
    const clothSh = _profDarken(clothC, 0.22);
    const eyeC    = PROF_EYE_COLOR[p.eyes?.color]   || PROF_EYE_COLOR.blue;
    const expr    = p.face?.expression || 'neutral';
    const hairSt  = p.hair?.style      || 'none';
    const glassSt = p.glasses?.style   || 'none';
    const earMod  = p.ears?.style      || 'none';
    const piercings = Array.isArray(p.piercings) ? p.piercings : [];
    const earrings  = Array.isArray(p.earrings)  ? p.earrings  : [];
    const extras    = Array.isArray(p.extras)    ? p.extras    : [];

    const layers = [];

    // Layer order (back → front):
    //   hairBack → baseBody → clothing → ears → head → eyes → faceDetails
    //   → extras → glasses → piercings → hairFront → earrings
    _profAvatarHairBack(hairSt, hairC, hairSh, layers);
    _profAvatarBaseBody(skin, skinSh, layers);
    _profAvatarClothing(p.clothing?.style || 'hoodie', clothC, clothSh, layers);
    _profAvatarEars(skin, skinSh, earMod, layers);
    // Head — slightly rounder (ry 23 vs old 24) for a softer, more natural look
    layers.push(`<ellipse cx="50" cy="46" rx="22" ry="23" fill="${skin}"/>`);
    _profAvatarEyes(expr, eyeC, layers);
    _profAvatarFaceDetails(skin, skinSh, expr, layers);
    _profAvatarExtras(extras, layers);
    if (glassSt !== 'none') _profAvatarGlasses(glassSt, layers);
    if (piercings.includes('septum'))    layers.push(`<path d="M47 58 Q50 61.5 53 58" fill="none" stroke="#C4C4C4" stroke-width="1.8" stroke-linecap="round"/>`);
    if (piercings.includes('nostril_l')) layers.push(`<circle cx="44" cy="56.5" r="1.6" fill="#C4C4C4"/>`);
    if (piercings.includes('nostril_r')) layers.push(`<circle cx="56" cy="56.5" r="1.6" fill="#C4C4C4"/>`);
    _profAvatarHairFront(hairSt, hairC, hairSh, layers);
    _profAvatarEarrings(earrings, layers);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="90" height="90" aria-hidden="true">${layers.join('')}</svg>`;
}

export function _profRandomTraits() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const rndMulti = (opts, max) => {
        const shuffled = [...opts].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.floor(Math.random() * (max + 1))).map(o => o.value);
    };
    // Pull option arrays from the tab definitions so random stays in sync with editor
    const tabSecs = id => PROF_EDITOR_TABS.find(t => t.id === id).sections;
    const [skinOpts, exprOpts]  = tabSecs('face').map(s => s.options);
    const [hairSOpts, hairCOpts] = tabSecs('hair').map(s => s.options);
    const [eyeCOpts]             = tabSecs('eyes').map(s => s.options);
    const [glassOpts, earMOpts, pierOpts, erngOpts] = tabSecs('accessories').map(s => s.options);
    const [extrOpts, clothSOpts, clothCOpts]         = tabSecs('extras').map(s => s.options);
    return {
        base:      { skin: pick(skinOpts).value },
        ears:      { style: pick(earMOpts).value },
        hair:      { style: pick(hairSOpts).value, color: pick(hairCOpts).value },
        face:      { expression: pick(exprOpts).value },
        eyes:      { color: pick(eyeCOpts).value },
        glasses:   { style: pick(glassOpts).value },
        piercings: rndMulti(pierOpts, 2),
        earrings:  rndMulti(erngOpts, 2),
        extras:    rndMulti(extrOpts, 2),
        clothing:  { style: pick(clothSOpts).value, color: pick(clothCOpts).value },
    };
}

// Render tab buttons + sections for the active tab
export function _profRenderEditorTabs(activeTab) {
    return PROF_EDITOR_TABS.map(t =>
        `<button class="avatar-tab-btn${t.id === activeTab ? ' active' : ''}" onclick="pfAvatarTab('${t.id}')" type="button">${t.label}</button>`
    ).join('');
}

export function _profRenderEditorSections(draft, activeTab) {
    const tab = PROF_EDITOR_TABS.find(t => t.id === activeTab) || PROF_EDITOR_TABS[0];
    return tab.sections.map(def => {
        const [part, key] = def.path.split('.');
        const cur = key ? (draft[part]?.[key]) : draft[part];
        const opts = def.options.map(opt => {
            const sel = def.type === 'multi'
                ? (Array.isArray(cur) && cur.includes(opt.value))
                : cur === opt.value;
            if (def.type === 'swatch') {
                return `<button class="avatar-swatch${sel ? ' selected' : ''}" title="${opt.label}" style="background:${opt.color}" onclick="pfAvatarPick('${def.path}','${opt.value}',false)" type="button"></button>`;
            }
            const multi = def.type === 'multi';
            return `<button class="avatar-trait-btn${sel ? ' selected' : ''}" onclick="pfAvatarPick('${def.path}','${opt.value}',${multi})" type="button">${opt.label}</button>`;
        }).join('');
        return `<div class="avatar-trait-section"><span class="avatar-trait-label">${def.label}</span><div class="avatar-trait-options">${opts}</div></div>`;
    }).join('');
}

export const PAIN_LOCATIONS = [
    { id: 'head',      label: 'Head' },
    { id: 'neck',      label: 'Neck' },
    { id: 'shoulders', label: 'Shoulders' },
    { id: 'chest',     label: 'Chest' },
    { id: 'back',      label: 'Back' },
    { id: 'abdomen',   label: 'Abdomen' },
    { id: 'arms',      label: 'Arms' },
    { id: 'hands',     label: 'Hands' },
    { id: 'hips',      label: 'Hips' },
    { id: 'legs',      label: 'Legs' },
    { id: 'feet',      label: 'Feet' },
    { id: 'other',     label: 'Other' },
];

