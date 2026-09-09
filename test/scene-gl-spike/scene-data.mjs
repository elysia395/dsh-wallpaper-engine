// 自动生成 (extract-assets.mjs) — 请勿手改
export const SCENE_DATA = {
  "pkg": "/home/beef/Pictures/WallpaperEngine/3295448069/scene.pkg",
  "scene": {
    "camera": {
      "center": "0.00000 0.00000 -1.00000",
      "eye": "0.00000 0.00000 0.00000",
      "up": "0.00000 1.00000 0.00000"
    },
    "general": {
      "ambientcolor": "0.30000 0.30000 0.30000",
      "bloom": false,
      "bloomhdrfeather": 0.1,
      "bloomhdriterations": 8,
      "bloomhdrscatter": 1.619,
      "bloomhdrstrength": 2,
      "bloomhdrthreshold": 1,
      "bloomstrength": 2,
      "bloomthreshold": 0.64999998,
      "bloomtint": "1.00000 1.00000 1.00000",
      "camerafade": true,
      "cameraparallax": false,
      "cameraparallaxamount": 0.5,
      "cameraparallaxdelay": 0.1,
      "cameraparallaxmouseinfluence": 0.5,
      "camerapreview": true,
      "camerashake": false,
      "camerashakeamplitude": 0.5,
      "camerashakeroughness": 1,
      "camerashakespeed": 3,
      "clearcolor": "0.70000 0.70000 0.70000",
      "clearenabled": true,
      "farz": 10000,
      "fov": 50,
      "hdr": false,
      "nearz": 0.0099999998,
      "orthogonalprojection": {
        "height": 2160,
        "width": 3840
      },
      "perspectiveoverridefov": 30,
      "skylightcolor": "0.30000 0.30000 0.30000",
      "zoom": 1
    },
    "objects": [
      {
        "castshadow": false,
        "effects": [
          {
            "file": "effects/waterripple/effect.json",
            "id": 75,
            "name": "",
            "passes": [
              {
                "constantshadervalues": {
                  "animationspeed": 0.15000001,
                  "ratio": 1,
                  "ripplestrength": 0.1,
                  "scale": 1,
                  "scrolldirection": 0,
                  "scrollspeed": 0
                },
                "id": 76,
                "textures": [
                  null,
                  "masks/waterripple_mask_206a0206",
                  "effects/waterripplenormal"
                ]
              }
            ],
            "visible": {
              "user": "shuijio",
              "value": true
            }
          },
          {
            "file": "effects/iris/effect.json",
            "id": 95,
            "name": "",
            "passes": [
              {
                "constantshadervalues": {
                  "noiseamount": 0.5,
                  "phase": 0,
                  "rough": 0.2,
                  "scale": "1 1",
                  "speed": 1
                },
                "id": 96,
                "textures": [
                  null,
                  "masks/iris_mask_d44b353d"
                ]
              }
            ],
            "visible": {
              "user": "yandong",
              "value": true
            }
          }
        ],
        "id": 16,
        "image": "models/207电脑.json",
        "locktransforms": true,
        "name": "207电脑",
        "origin": "1920.00000 1080.00000 0.00000",
        "size": "3840.00000 2160.00000"
      }
    ],
    "version": 4
  },
  "effects": {
    "waterripple": {
      "version": 1,
      "replacementkey": "waterripple",
      "name": "ui_editor_effect_water_ripple_title",
      "description": "ui_editor_effect_water_ripple_description",
      "group": "animate",
      "preview": "preview/project.json",
      "passes": [
        {
          "material": "materials/effects/waterripple.json"
        }
      ],
      "dependencies": [
        "materials/effects/waterripple.json",
        "materials/effects/waterripplenormal.png",
        "materials/effects/waterripplenormal.tex-json",
        "shaders/effects/waterripple.frag",
        "shaders/effects/waterripple.vert"
      ],
      "gizmos": [
        {
          "type": "EffectPerspectiveUV",
          "condition": {
            "PERSPECTIVE": 1
          },
          "vars": {
            "p0": "point0",
            "p1": "point1",
            "p2": "point2",
            "p3": "point3"
          }
        }
      ]
    },
    "iris": {
      "version": 1,
      "replacementkey": "iris",
      "name": "ui_editor_effect_iris_title",
      "description": "ui_editor_effect_iris_description",
      "group": "animate",
      "preview": "preview/project.json",
      "passes": [
        {
          "material": "materials/effects/iris.json"
        }
      ],
      "dependencies": [
        "materials/effects/iris.json",
        "shaders/effects/iris.frag",
        "shaders/effects/iris.vert"
      ]
    }
  },
  "materials": {
    "main": {
      "passes": [
        {
          "blending": "translucent",
          "combos": {},
          "cullmode": "nocull",
          "depthtest": "disabled",
          "depthwrite": "disabled",
          "shader": "genericimage4",
          "textures": [
            "207电脑"
          ]
        }
      ]
    },
    "waterripple": {
      "passes": [
        {
          "shader": "effects/waterripple",
          "blending": "normal",
          "depthtest": "disabled",
          "depthwrite": "disabled",
          "cullmode": "nocull",
          "textures": [
            null,
            null,
            "effects/waterripplenormal"
          ]
        }
      ]
    },
    "iris": {
      "passes": [
        {
          "shader": "effects/iris",
          "blending": "normal",
          "depthtest": "disabled",
          "depthwrite": "disabled",
          "cullmode": "nocull"
        }
      ]
    }
  },
  "textures": {
    "materials/207电脑.tex": {
      "file": "207__.png",
      "w": 3840,
      "h": 2160,
      "kind": "png-pass"
    },
    "materials/masks/waterripple_mask_206a0206.tex": {
      "file": "masks__waterripple_mask_206a0206.png",
      "w": 1920,
      "h": 1080,
      "kind": "rgba"
    },
    "materials/masks/iris_mask_d44b353d.tex": {
      "file": "masks__iris_mask_d44b353d.png",
      "w": 1920,
      "h": 1080,
      "kind": "rgba"
    },
    "materials/effects/waterripplenormal.tex": {
      "file": "effects__waterripplenormal.png",
      "w": 256,
      "h": 256,
      "kind": "rgba"
    }
  }
};
