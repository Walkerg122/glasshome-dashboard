# Your own floor plan

The **Home Plan** page (`features.floorplan: true`) shows an interactive 2D plan. Until you add your own, a
fictional two-storey sample plan is used, so you can try it straight away.

## The building editor

You don't need to write any of the format below by hand. Open **Settings → Floor plan → Upload or draw my plan**,
or on the Plan page press **Edit**, then **Building**. Start from:

- **Upload a picture**: a photo, scan or screenshot of your floor plan (an estate agent's plan works well). It is
  fitted to the page, and you can use it as it is, or draw rooms and walls over it so they light up and can be
  tapped. **Picture** changes how strong it is, its size and position, or replaces it.
- **Draw it myself**: an empty page.
- **Change the sample**: a copy of the sample plan to move walls and rooms around.

Tools: **Move** (select, drag, arrow keys to nudge), **Wall** (drag), **Window** (drag along a wall), **Door** (drag across the doorway from the hinge side, then choose which way it opens),
**Room** (drag a box), **Shape** (tap the corners of an L-shaped or angled room), **Picture** and **Erase**. Windows
and doors cut their gap in the wall. Rooms take a name, an optional size label and a floor finish. **+ Floor** adds
another storey. **Undo** (Ctrl+Z) works for every change, and nothing is saved until you press **Save**.

**Save** writes `floorplan.arch` and `floorplan.images` into the dashboard's `glasshome:` settings and reloads.
Pictures are re-encoded in your browser to WebP or JPEG (at most 1800 pixels, usually under 650 KB) before they
are saved, so only the image itself is kept: no file name, location or camera details. The whole plan must stay
under about 3 MB. It is stored in the dashboard configuration, which only people signed in to your Home
Assistant can read.

Then place your devices: on the Plan page press **Edit**, then **Devices**, add each one and drag it into place.

## Two layers

1. **The building**: outline, rooms, walls, windows, doors and stairs. This comes from `floorplan.arch` in
   your `glasshome:` settings.
2. **Furniture and devices**: added, dragged, rotated and resized on the page itself with **Edit**. They are
   saved in Home Assistant's frontend storage, separately for each floor, so every device sees the same plan
   (it falls back to per-user storage, then to the browser, if that is not available).

## Pictures

```yaml
floorplan:
  images:
    ground: { src: "data:image/webp;base64,...", x: 29, y: 4, w: 615, h: 410, opacity: 0.9 }
```

Only `data:image/png`, `jpeg` or `webp` pictures with a position and size are drawn; anything else (an SVG, a web
address) is ignored. Use the building editor to add one.

## Coordinates

Each floor is drawn on a canvas about **672 × 418 units**, with the origin at the top left. A practical scale is
around 70 units per metre. Measure your rooms, sketch them on squared paper, then copy the corner points.

## Format

```yaml
floorplan:
  arch:
    ground:                                     # floor id (any short name)
      name: GROUND FLOOR                        # label on the floor switch
      outline: [[4, 4], [668, 4], [668, 414], [4, 414]]      # outside of the building, a polygon
      rooms:
        - id: living
          name: Living Room
          dims: "4.10 × 5.50 m"
          floor: oak
          poly: [[19, 19], [300, 19], [300, 399], [19, 399]]  # room polygon
          label: [110, 200]                                   # where the name is written
      walls: [[4, 4, 80, 19], [300, 19, 307, 150]]           # rectangles: x1, y1, x2, y2
      windows: [[80, 4, 220, 19]]                            # rectangles in the wall line
      sliders: []                                            # sliding doors, same shape as windows
      doors: [{ h: [303, 152], r: 48, a0: 180, a1: 90 }]     # hinge point, radius, swing from a0° to a1°
      stairs:                                                # optional
        box: [315, 210, 392, 380]
        treads: [244, 278, 312, 346]
        centre: [353, 212, 353, 378]
        arrow: [[340, 226], [353, 214], [366, 226]]
        brk: null
    first: { name: FIRST FLOOR }                             # ...same shape as ground
  fittings:                                     # optional fixed fittings placed on a new plan
    ground: [[sink, 550, 37, 60, 36, 0]]        # [type, centre x, centre y, width, depth, rotation°]
  status_only: [light.porch]                    # devices shown but never switched from the plan
```

- `floor`: the floor finish. One of `oak`, `stone`, `tile` or `carpet`.
- `small: true` on a room uses a smaller label.
- Door angles are in degrees, measured clockwise from pointing right: 0 = right, 90 = down, 180 = left, 270 = up.
- Leave `walls` gaps where doors and windows go.

The full working example is the sample plan in `www/glasshome/glasshome-cards.js` (search for `SAMPLE_ARCH`).

## Furniture types

Living room: `sofa`, `sofa2`, `armchair`, `coffee_table`, `side_table`, `tv_unit`, `tv`, `rug`, `floor_lamp`,
`bookcase`, `plant`. Bedroom: `bed_double`, `bed_king`, `bed_single`, `bedside`, `wardrobe`, `dresser`,
`dressing_table`. Kitchen: `worktop`, `sink`, `hob`, `oven`, `fridge`, `fridge_freezer`, `washing_machine`,
`dishwasher`, `kitchen_island`. Bathroom: `toilet`, `basin`, `bath`, `shower`, `towel_rail`, `bath_cabinet`.
Dining room: `dining_table`, `round_table`, `dining_chair`, `sideboard`. Hallway: `console_table`, `shoe_rack`,
`coat_stand`, `hall_bench`. General: `desk`, `office_chair`, `storage_unit`, `radiator`, `box`.

## Placing devices

Open the page, tap **Edit** and switch to **Devices**, add an entity and drag it to its place. Tap a device in normal
mode to see its live state and controls.
