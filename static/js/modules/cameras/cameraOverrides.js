export const CAMERA_OVERRIDES = {
  // Default hero (pinned), hidden from tiles
  doorbell: { name: "Front Door", area: "Entrance", order: 1, pinnedHero: true, hidden: true },

  // EXACTLY 6 tile cameras (visible, ordered)
  patio: { name: "Patio", area: "Patio", order: 10, hidden: false },
  backyard: { name: "Backyard", area: "Backyard", order: 20, hidden: false },
  front_yard: { name: "Front Yard", area: "Front Yard", order: 30, hidden: false },
  driveway: { name: "Driveway", area: "Driveway", order: 40, hidden: false },
  side_gate: { name: "Side Gate", area: "Side Gate", order: 50, hidden: false },
  tilt_pan: { name: "Tilt Pan", area: "Garage", order: 60, hidden: false },

  // Discovered but hidden from wall tiles by default
  kitchen: { name: "Kitchen", area: "Kitchen", hidden: true },
  piano_room: { name: "Piano Room", area: "Piano Room", hidden: true }
};
