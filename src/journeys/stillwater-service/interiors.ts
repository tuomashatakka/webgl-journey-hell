import { hash1 } from '@wjh/math/scalar'
import { ring } from './geometry'
import type { Stage } from './geometry'


const whiteTile = { surface: 'tile', color: 0xb8c5bc } as const
const blueTile  = { surface: 'tile', color: 0x2d706e } as const
const lane      = { surface: 'marking', color: 0x143641 } as const
const light     = { surface: 'light', color: 0xfff1c6 } as const
const steel     = { surface: 'steel', color: 0x55605c } as const
const shadow    = { surface: 'plain', color: 0x142528 } as const
const concrete  = { surface: 'concrete', color: 0x68706b } as const

function door (stage: Stage, x: number, y: number, z: number): void {
  stage.box(shadow, [ x, y + 1.09, z ], [ 1.63, 2.18, 0.23 ])
  stage.box(steel, [ x - 0.85, y + 1.17, z - 0.035 ], [ 0.11, 2.36, 0.32 ])
  stage.box(steel, [ x + 0.85, y + 1.17, z - 0.035 ], [ 0.11, 2.36, 0.32 ])
  stage.box(steel, [ x, y + 2.31, z - 0.035 ], [ 1.79, 0.15, 0.32 ])
  stage.box(lane, [ x, y + 1.01, z - 0.126 ], [ 1.56, 0.112, 0.015 ])
  stage.box(light, [ x + 0.66, y + 1.03, z - 0.154 ], [ 0.055, 0.14, 0.025 ])
}

export function buildPool (stage: Stage): void {
  const { box }  = stage
  const skylight = { surface: 'light', color: 0xdff9ed } as const
  box(whiteTile, [ -2.75, 6.9, 15 ], [ 16, 0.32, 39 ])
  box(whiteTile, [ -10.9, 2.7, 15 ], [ 0.35, 8.8, 39 ])
  box(whiteTile, [ 5.25, 2.7, 15 ], [ 0.4, 8.8, 39 ])
  box(whiteTile, [ -2.75, 2.9, 33.1 ], [ 16, 8.3, 0.4 ])
  box(whiteTile, [ -2.75, 2.9, -4.5 ], [ 16, 8.3, 0.4 ])
  box(whiteTile, [ -2.75, -0.15, 0.1 ], [ 16, 0.3, 8.2 ])
  box(whiteTile, [ -2.75, -0.15, 30.9 ], [ 16, 0.3, 5 ])
  box(whiteTile, [ 2.95, -0.15, 16 ], [ 4.5, 0.3, 24 ])
  box(whiteTile, [ -9.9, -0.15, 16 ], [ 1.9, 0.3, 24 ])
  box(blueTile, [ -4.4, -1.25, 16 ], [ 9.35, 0.32, 24 ])
  box({ surface: 'poolWater', color: 0x56b6a2 }, [ -4.15, -0.47, 16 ], [ 9.7, 0.025, 24 ])
  box(lane, [ 1.03, 0.012, 16 ], [ 0.11, 0.025, 24 ])
  for (let stair = 0; stair < 4; stair++)
    box(blueTile, [ -6.8, -0.16 - stair * 0.25, 4.25 + stair * 0.41 ], [ 2.45, 0.3, 0.52 ])

  for (let z = -1; z <= 31; z += 4) {
    box(whiteTile, [ -2.75, 6.21, z ], [ 15.7, 0.42, 0.43 ])
    for (const x of [ -10.6, 4.9 ])
      box(whiteTile, [ x, 3, z ], [ 0.43, 6.5, 0.41 ])
    box(skylight, [ -4, 6.66, z + 1.98 ], [ 6.8, 0.09, 2.45 ])
    box({ surface: 'glass', color: 0x29494c }, [ 5.01, 2.68, z + 1.95 ], [ 0.14, 1.39, 2.65 ])
    box(light, [ 4.99, 1.24, z + 1.95 ], [ 0.17, 0.078, 0.97 ])
    box(lane, [ -10.69, 0.13, z + 1.98 ], [ 0.09, 0.13, 3.52 ])
  }
  for (const z of [ 6, 23 ]) {
    for (const x of [ 0.54, 0.98 ])
      box(steel, [ x, 0.23, z ], [ 0.065, 1.36, 0.065 ])
    for (const y of [ -0.64, -0.31, 0.02 ])
      box(steel, [ 0.76, y, z - 0.045 ], [ 0.46, 0.038, 0.08 ])
  }
  door(stage, 2.15, 0, 32.75)
  box(whiteTile, [ 2.15, 1.15, 32.55 ], [ 2.8, 0.32, 0.74 ])
}

export function buildAnnex (stage: Stage): void {
  const { box } = stage
  const wall    = { surface: 'acoustic', color: 0xbda477 } as const
  const ceiling = { surface: 'acoustic', color: 0xe0ca91 } as const
  const wood    = { surface: 'plain', color: 0x392c21 } as const
  const carpet  = { surface: 'carpet', color: 0x896b38 } as const
  box(carpet, [ 4, -0.17, 10 ], [ 20, 0.34, 30 ])
  box(ceiling, [ 4, 2.83, 10 ], [ 20, 0.25, 30 ])
  for (const x of [ -5.8, 13.8 ])
    box(wall, [ x, 1.36, 10 ], [ 0.28, 2.75, 30 ])
  for (const z of [ -4.8, 24.8 ])
    box(wall, [ 4, 1.36, z ], [ 20, 2.75, 0.28 ])

  box(wall, [ 2, 1.37, 0.96 ], [ 0.22, 2.74, 11.8 ])
  box(wall, [ 6.7, 1.37, 18.6 ], [ 0.21, 2.74, 12.2 ])
  box(wall, [ 10.4, 1.37, 5.2 ], [ 5.5, 2.74, 0.21 ])
  box(wall, [ -2.35, 1.37, 12.5 ], [ 6.45, 2.74, 0.21 ])
  for (const x of [ -3.7, 4.45, 11.7 ])
    for (const z of [ 0, 6.5, 12.8, 19.4, 23.1 ]) {
      box(wall, [ x, 1.36, z ], [ 0.68, 2.72, 0.64 ])
      box(wood, [ x, 0.08, z ], [ 0.72, 0.16, 0.68 ])
    }

  for (let x = -3; x <= 12; x += 3)
    for (let z = -2; z <= 23; z += 3.4) {
      box(wood, [ x, 2.69, z ], [ 1.3, 0.11, 0.44 ])
      box(light, [ x, 2.618, z ], [ 1.14, 0.055, 0.34 ])
    }

  box(lane, [ -1.54, 0.009, 7.5 ], [ 0.09, 0.018, 9.85 ])
  box(lane, [ -4.45, 0.009, 7.5 ], [ 0.09, 0.018, 9.85 ])
  for (const z of [ 2.58, 12.42 ])
    box(lane, [ -3, 0.009, z ], [ 2.96, 0.018, 0.09 ])
  for (const x of [ -3.96, -3.02, -2.07 ])
    box(lane, [ x, 0.008, 7.5 ], [ 0.055, 0.014, 8.6 ])
  box(lane, [ 13.64, 1.36, 18.2 ], [ 0.02, 2.72, 0.11 ])
  box({ ...lane, firstLap: 2 }, [ 13.64, 1.36, 18.55 ], [ 0.02, 1.91, 0.08 ])
  door(stage, 9.8, 0, 24.53)
}

export function buildLift (stage: Stage): void {
  const { box }   = stage
  const cage      = { ...steel, motion: 'cage' } as const
  const cabFloor  = { surface: 'belt', color: 0x4b554e, motion: 'cage' } as const
  const cageLight = { ...light, motion: 'cage' } as const

  for (const x of [ -3.4, 3.4 ])
    box(concrete, [ x, -25, 0 ], [ 0.4, 56, 7.8 ])
  for (const z of [ -3.7, 3.7 ])
    box(concrete, [ 0, -25, z ], [ 7, 56, 0.4 ])
  for (const x of [ -2.58, 2.38 ]) {
    box(shadow, [ x, -24, 2.16 ], [ 0.19, 55, 0.18 ])
    box(steel, [ x, -24, 2.19 ], [ 0.065, 55, 0.085 ])
    box(steel, [ x * 0.87, -24, 2.19 ], [ 0.085, 55, 0.085 ])
  }

  for (let y = 1; y >= -49; y -= 6) {
    box(steel, [ 0, y, 3.37 ], [ 6.65, 0.36, 0.92 ])
    box(shadow, [ 0.1, y + 1.17, 3.45 ], [ 2.3, 2.56, 0.25 ])
    box(light, [ 0.1, y + 2.46, 3.28 ], [ 2.4, 0.085, 0.17 ])
    box(lane, [ -2.55, y + 1.53, 3.46 ], [ 0.56, 0.66, 0.13 ])
    box(concrete, [ 0, y + 0.6, -3.4 ], [ 6.6, 0.95, 0.74 ])
  }

  box(cabFloor, [ 0, -1.67, 0.1 ], [ 2.78, 0.18, 2.95 ])
  box(cage, [ 0, 1.23, 0.1 ], [ 2.78, 0.14, 2.95 ])
  box(cageLight, [ 0, 1.145, 0.23 ], [ 1.69, 0.048, 0.11 ])
  box(cage, [ 0, -0.73, 1.53 ], [ 2.78, 0.075, 0.055 ])
  for (const x of [ -1.34, 1.34 ]) {
    for (let z = -1.3; z < 1.65; z += 0.18)
      box(cage, [ x, -0.23, z ], [ 0.045, 2.78, 0.042 ])
    for (let y = -1.46; y < 1.18; y += 0.18)
      box(cage, [ x, y, 0.1 ], [ 0.045, 0.041, 2.9 ])
    box(cage, [ x, -0.24, 1.53 ], [ 0.13, 2.85, 0.15 ])
  }
}

export function buildLounge (stage: Stage): void {
  const { box }    = stage
  const colorGlass = { surface: 'glass', color: 0x1b4b59 } as const
  box(blueTile, [ 0, -0.17, 13 ], [ 15.8, 0.34, 31 ])
  box(whiteTile, [ 0, 5.68, 13 ], [ 15.8, 0.35, 31 ])
  box(whiteTile, [ -7.95, 2.7, 13 ], [ 0.31, 5.6, 31 ])
  box(whiteTile, [ 7.95, 2.7, 13 ], [ 0.31, 5.6, 31 ])
  box(whiteTile, [ 0, 2.7, 28.23 ], [ 15.8, 5.6, 0.32 ])
  box(whiteTile, [ 0, 2.7, -2.5 ], [ 15.8, 5.6, 0.32 ])
  for (const x of [ -5.1, 5.1 ])
    for (let z = 3; z < 23; z += 3.5) {
      box(blueTile, [ x, 0.72, z ], [ 2.76, 0.18, 0.58 ])
      box(steel, [ x, 1.03, z + 0.29 ], [ 2.76, 0.52, 0.1 ])
      for (const side of [ -1, 1 ])
        box(concrete, [ x + side * 0.94, 0.35, z ], [ 0.19, 0.72, 0.44 ])
      box(colorGlass, [ Math.sign(x) * 7.75, 3.1, z ], [ 0.15, 2.15, 2.49 ])
      box(whiteTile, [ Math.sign(x) * 3.06, 2.7, z ], [ 0.31, 5.56, 0.31 ])
    }
  for (let i = 0; i < 4; i++) {
    box(lane, [ i * 1.8 - 2.7, 0.012, 12.3 ], [ 0.087, 0.025, 25.5 ])
    box(whiteTile, [ -6.85, 0.12 + i * 0.21, 21.2 + i * 0.9 ], [ 2.08, 0.24 + i * 0.42, 0.9 ])
  }
  box(shadow, [ 0.1, 5.46, 25.66 ], [ 2.88, 0.16, 3.42 ])
  box({ surface: 'light', color: 0x76e2dc }, [ 0.1, 5.37, 25.66 ], [ 2.47, 0.1, 2.95 ])
  box(lane, [ 0.08, 2.85, 28.05 ], [ 1.48, 0.185, 0.043 ])
}

export function buildCarousel (stage: Stage): void {
  const { box } = stage
  const wall    = { surface: 'acoustic', color: 0xc9cec6 } as const
  const belt    = { surface: 'belt', color: 0x414844 } as const
  const glass   = { surface: 'glass', color: 0xadccc1 } as const
  const crate   = { surface: 'concrete', color: 0xa39f8a } as const
  box(whiteTile, [ 0, -0.16, 8 ], [ 22, 0.32, 20 ])
  box(wall, [ 0, 4.62, 8 ], [ 22, 0.26, 20 ])
  for (const x of [ -10.85, 10.85 ])
    box(wall, [ x, 2.26, 8 ], [ 0.28, 4.53, 20 ])
  for (const z of [ -1.9, 17.9 ])
    box(wall, [ 0, 2.26, z ], [ 22, 4.53, 0.28 ])
  ring(stage.geometry(steel), [ 0, 0.36, 8 ], 5.32, 1.71, 0.34, 'up', 96)
  ring(stage.geometry(belt), [ 0, 0.7, 8 ], 5.2, 1.47, 0.035, 'up', 96)
  ring(stage.geometry(lane), [ 0, 0.748, 8 ], 5.13, 0.085, 0.009, 'up', 96)
  box({ ...blueTile, motion: 'tile' }, [ 0, 0, 0 ], [ 0.34, 0.087, 0.31 ])
  box({ ...light, motion: 'tile' }, [ 0, 0.05, 0 ], [ 0.19, 0.022, 0.14 ])
  for (const x of [ -8.55, 8.55 ])
    for (let z = 2; z < 16; z += 2.4) {
      box(steel, [ x, 0.65, z ], [ 1.65, 0.09, 1.73 ])
      box(steel, [ x, 1.4, z ], [ 1.65, 0.08, 1.73 ])
      box(steel, [ x, 2.18, z ], [ 1.65, 0.08, 1.73 ])
      for (const side of [ -1, 1 ]) {
        box(steel, [ x - 0.79, 1.2, z + side * 0.84 ], [ 0.095, 2.4, 0.095 ])
        box(steel, [ x + 0.79, 1.2, z + side * 0.84 ], [ 0.095, 2.4, 0.095 ])
      }
      for (let slat = -3; slat <= 3; slat++)
        box(steel, [ x * 0.91, 1.37, z + slat * 0.19 ], [ 0.027, 1.55, 0.026 ])
      if (hash1(z * 5.9 + x) > 0.38)
        box(crate, [ x, 0.92, z ], [ 0.66, 0.48, 0.86 ])
    }
  for (const x of [ -6, 0, 6 ])
    for (const z of [ 2, 6, 10, 14 ])
      box(light, [ x, 4.46, z ], [ 3.5, 0.11, 0.25 ])
  box(concrete, [ 0.8, 0.58, 1.05 ], [ 2.9, 1.16, 1.1 ])
  box(glass, [ 0.8, 2.04, 0.99 ], [ 2.94, 1.78, 0.12 ])
  box(steel, [ 0.8, 2.98, 0.99 ], [ 3.13, 0.12, 0.18 ])
  door(stage, 0.8, 0, 1.2)
}
