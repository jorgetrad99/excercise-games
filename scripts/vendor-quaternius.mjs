// Downloads the Quaternius CC0 models the game uses from Quaternius' public Google Drive folders
// (linked from quaternius.com/packs/*.html) and converts them to .glb in public/assets/quaternius/.
// Converters run through npx at vendoring time only (not project dependencies):
//   obj2gltf@3.2.0 (OBJ+MTL → GLB), @gltf-transform/cli@4.5.0 (glTF → GLB, prune, texture resize).
// Usage: node scripts/vendor-quaternius.mjs   (idempotent; re-downloads into tmp/quaternius/src)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = 'tmp/quaternius/src';
const OUT = 'public/assets/quaternius';
const drive = (id) => `https://drive.google.com/uc?export=download&id=${id}`;

// pack → { license: Drive id | null (license on the pack page), files: { name: id } }
const PACKS = {
  character: {
    page: 'https://quaternius.com/packs/ultimatemodularcharacters.html',
    license: '1TTvylHa1CsiJuHFWWiv6PFGhLM-aAH5z',
    files: { 'Casual_Hoodie.gltf': '1em1So1xwwQNfHJYMvzKcXkZllvtxpKP5' },
  },
  streets: {
    page: 'https://quaternius.com/packs/modularstreets.html',
    license: '1dQeZG3ayMqbN_nTD7yowP2b6rOZ25HEJ',
    files: {
      'Streetlight_Single.obj': '1T-lxIMpC24ZSNJbPGeOE-rNnAIC4znzY',
      'Streetlight_Single.mtl': '1gJhlmtqNN96X51Qn7K1uItMovt_VykbY',
      'TrafficLight.obj': '1MjwDjpS8oEBOb8JiTLni3xfuTeAZwQI0',
      'TrafficLight.mtl': '1jLxxRtbts8DiZxzCTcMT3uBJqj1lA1vZ',
      'Sign_Stop.obj': '1bLWfiXncg3nQtP1janHKZaViW-4ftTao',
      'Sign_Stop.mtl': '193B8vagB7i1AJp5RNtKwO_3Pkdi7F7mF',
      'Sign_NoParking.obj': '1lnv8cfYkdkiXHlCkm7a7UZ94NsnvbMBh',
      'Sign_NoParking.mtl': '1UcHK5PioyVtlqWT6kJqJXEKm7NlwGnDb',
    },
  },
  cars: {
    page: 'https://quaternius.com/packs/cars.html',
    license: '1CqsvhpIzBNSDlZsBWdJcJNC1B-TE3cXK',
    files: {
      'NormalCar1.obj': '1dfatafHMRRxI3WE5srluI4Y4WD72pCD6',
      'NormalCar1.mtl': '1S-ieWN4XulN6T__2buAX7AsmvzMi8P0v',
      'NormalCar2.obj': '1Msv8m0vli0YGLLEHIx_ojM6grpmD_ygz',
      'NormalCar2.mtl': '11tdwW7kn3WvZ6SaUo92QBN_IXyh86KDZ',
      'SUV.obj': '1_26j_0vooPFidwFSlHRWlF1ifphQZemK',
      'SUV.mtl': '12V4PUvyNhfAPA9VejWYFsbniXd9Twsnt',
      'Taxi.obj': '1UMriCC_JWsDfpTh5tBjQdhAj9_lJeuR2',
      'Taxi.mtl': '1vnTRCYyHM_-IiE_XetjJMHdxD_yE4GZu',
    },
  },
  transport: {
    page: 'https://quaternius.com/packs/publictransport.html',
    license: null,
    files: {
      'Bus.obj': '1jVrZEPeLP0Inr4oVurmKDF1vAbJwAIOp',
      'Bus.mtl': '1loWXJGVX5_W1jrFnZEYr1C2PyDRGaweg',
      'SchoolBus.obj': '1XD1hn755_0z0Vp1Xi2vHwavQC9Z_RDrp',
      'SchoolBus.mtl': '1jSnmInEZC-56FUZxBfBbpANY2Q0iNU63',
    },
  },
  buildings: {
    page: 'https://quaternius.com/packs/buildings.html',
    license: '1cZI09Hrhv63ZOUfMYD9BwJ3Upb3AqUNP',
    files: {
      'Building2_Large.obj': '12XsE3-T35aanWpSz4slzAKCooOJF4h6K',
      'Building2_Large.mtl': '1qXh32uLAN6WzBjonB37JzA50sCEs6KnC',
      'Building3_Big.obj': '1zhsH9me8nmNi47IKCgVgINSHqxcq-ra9',
      'Building3_Big.mtl': '1wjpAm6kKrJBPxkE6Mf-KbQC7tF8H3Mmb',
      'Building4.obj': '1SDFxiHFqhzQbBu_2ZtR4oqiIuhapxhr_',
      'Building4.mtl': '18drhRBSETLl7JA9gl_7icXk3pjhymMuO',
      'House2.obj': '17uRWzj1iHKrz7BjNeQC6xI7WeP5rLeM6',
      'House2.mtl': '1etyW2HYpqaeeMCwQiVSw1K2VRXsZLXSm',
    },
  },
  nature: {
    page: 'https://quaternius.com/packs/ultimatestylizednature.html',
    license: '1W3YGLar9Ie0Lwfw7QJv1x8oBLKFPuOkW',
    files: {
      'MapleTree_1.gltf': '1q64DhJrFsIAK5-ldyaA6yXPCs1etSY4t',
      'MapleTree_1.bin': '1Z2YE3ixij3rjunD6VMaFvjW0xr8Ktlgu',
      'MapleTree_3.gltf': '1DkxTpDUYqXSNBTuOaYceiscawEGSf4zm',
      'MapleTree_3.bin': '1mv1Avmwkdd5X580gOMXezqXI8XwAmXe3',
      'BirchTree_2.gltf': '1-IFr4_vcuyPDfpDA7v09xIuBvAWgVCN_',
      'BirchTree_2.bin': '1qEsSF4KkXsaVVDonE-1HjHN-qjtztnu-',
      'Bush_Large.gltf': '1E0Pa78JSmBhddkwnWy4uMiN-Jl-ySpTH',
      'Bush_Large.bin': '1LLfPoe7ZUYqOu_Td2bsRjrz8ALbLbRd0',
      'Bush_Large_Flowers.gltf': '1ZfIqi_ZVGWQoiv7aqL6toE2AxB1zaIyA',
      'Bush_Large_Flowers.bin': '1Uqx2arbqdrJNg0gs4dRQRW82dbGDyXu-',
      'Flower_3_Clump.gltf': '1wN9dUs7XZb3pwNUSFUPwuuuKlqGHXBU_',
      'Flower_3_Clump.bin': '1-O7Ljl2PU_Jw5PU1TFy9UssfNci_A07z',
      'MapleTree_Bark.jpg': '1ooEfm7ZxVwm1bal3qnY7E9ydqZ28k18P',
      'MapleTree_Bark_Normal.png': '19eBAksn5OX78sgvBfN7k41BHwyPDYtJS',
      'MapleTree_Leaves.png': '1GX7-YPXDd9S3-VQre1S4kASWQoHmasA1',
      'BirchTree_Bark.jpg': '1puC8NuyemENIPB40TOsKdqzp0EmUJe1g',
      'BirchTree_Bark_Normal.png': '1qg4n9gasJ-c_jQED-IBqx28Qu53CURcR',
      'BirchTree_Leaves.png': '1RPfkjEuuEwFno9gh3U0zQndzcB8DOr_S',
      'Bush_Leaves.png': '19xOyTuSATvkHhQd8zC6PW-y6RX761yGA',
      'Flowers.png': '1__uvRQhRXZcOQ_lsvkrZfDr9Alr8ru6U',
    },
  },
};

/** The skater only needs these clips; the rest (guns, swords, punches) are dropped. */
const KEEP_ANIMATIONS = ['Idle_Neutral', 'Run', 'Roll', 'Death', 'Wave'];

const sh = (cmd) => execSync(cmd, { stdio: 'inherit', shell: true });

async function download(id, path) {
  if (existsSync(path) && statSync(path).size > 0) return;
  const res = await fetch(drive(id));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 15).toString().includes('<!DOCTYPE')) throw new Error(`${path}: Drive returned HTML`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

function convert(pack, name) {
  const src = join(SRC, pack, name);
  const base = name.replace(/\.(obj|gltf)$/, '');
  const out = join(OUT, pack, `${base}.glb`);
  mkdirSync(dirname(out), { recursive: true });
  if (name.endsWith('.obj')) {
    sh(`npx -y obj2gltf@3.2.0 -i "${src}" -o "${out}"`);
    return;
  }
  let input = src;
  if (pack === 'character') {
    const gltf = JSON.parse(readFileSync(src, 'utf8'));
    gltf.animations = gltf.animations.filter((a) => KEEP_ANIMATIONS.includes(a.name));
    input = join(SRC, pack, `${base}.trimmed.gltf`);
    writeFileSync(input, JSON.stringify(gltf));
  }
  sh(`npx -y @gltf-transform/cli@4.5.0 prune "${input}" "${out}"`);
  if (pack === 'nature') sh(`npx -y @gltf-transform/cli@4.5.0 resize "${out}" "${out}" --width 512 --height 512`);
}

for (const [pack, { license, files }] of Object.entries(PACKS)) {
  for (const [name, id] of Object.entries(files)) await download(id, join(SRC, pack, name));
  if (license) {
    await download(license, join(SRC, pack, 'License.txt'));
    mkdirSync(join(OUT, pack), { recursive: true });
    copyFileSync(join(SRC, pack, 'License.txt'), join(OUT, pack, 'License.txt'));
  }
  for (const name of Object.keys(files)) if (/\.(obj|gltf)$/.test(name)) convert(pack, name);
}
console.log('done');
