// Real places each area is built from. lat/lon is the centre of the walkable terrain.
// Viewpoints are real overlooks: you arrive at one, facing its `look` target.
export const REGIONS = {
  craterLake: {
    name: 'Crater Lake, Oregon', lat: 42.94, lon: -122.105, span: 5,
    viewpoints: [
      { name: 'Rim Village', at: [42.9112, -122.1452], look: [42.9397, -122.166] },
      { name: 'Discovery Point', at: [42.9425, -122.1505], look: [42.9397, -122.166] },
      { name: 'Cloudcap', at: [42.931, -122.043], look: [42.9397, -122.166] },
    ],
  },
  maroonBells: {
    name: 'Maroon Bells, Colorado', lat: 39.085, lon: -106.95, span: 5,
    viewpoints: [
      { name: 'Maroon Lake', at: [39.0992, -106.9385], look: [39.0708, -106.989] },
      { name: 'Crater Lake Trail', at: [39.0865, -106.9585], look: [39.0708, -106.989] },
    ],
  },
  mtHood: {
    name: 'Mount Hood, Oregon', lat: 45.325, lon: -121.73, span: 5,
    viewpoints: [
      { name: 'Timberline', at: [45.3305, -121.7105], look: [45.3736, -121.6959] },
      { name: 'Mirror Lake Ridge', at: [45.2935, -121.7895], look: [45.3736, -121.6959] },
      { name: 'Zigzag Canyon', at: [45.3463, -121.7298], look: [45.3736, -121.6959] },
    ],
  },
  rowena: {
    name: 'Columbia River Gorge, Oregon', lat: 45.68, lon: -121.29, span: 5,
    viewpoints: [
      { name: 'Rowena Crest', at: [45.6829, -121.2995], look: [45.705, -121.38] },
      { name: 'Tom McCall Point', at: [45.6665, -121.3], look: [45.705, -121.27] },
      { name: 'Rowena Plateau', at: [45.6885, -121.3155], look: [45.71, -121.33] },
    ],
  },
  bigSur: {
    name: 'Big Sur, California', lat: 36.235, lon: -121.79, span: 5,
    viewpoints: [
      { name: 'Pfeiffer Beach', at: [36.2392, -121.8145], look: [36.232, -121.835] },
      { name: 'Pfeiffer Ridge', at: [36.2545, -121.8015], look: [36.22, -121.86] },
      { name: 'Valley View', at: [36.2458, -121.7667], look: [36.306, -121.901] },
    ],
  },
  pointReyes: {
    name: 'Point Reyes, California', lat: 38.06, lon: -122.95, span: 5,
    viewpoints: [
      { name: 'Drakes Beach', at: [38.0305, -122.9625], look: [38.015, -122.955] },
      { name: 'Point Reyes Headlands', at: [37.9985, -123.0105], look: [37.985, -123.03] },
      { name: 'Great Beach', at: [38.0705, -122.9725], look: [38.07, -123.0] },
    ],
  },
};
