The baby-mob-models.json and modern-mob-models.json geometry tables are extracted
from Blockbench's Minecraft skin presets (Java model where a choice is provided):
https://github.com/JannisX11/blockbench/blob/master/js/formats/minecraft/skin.ts

Copyright Blockbench contributors. The upstream license is included in
BLOCKBENCH-LICENSE.md. Textures are sourced separately from minecraft-assets.

These tables retain texture dimensions and geometry, without editor UI or code.
Baby models use their native pixel sizes and must not receive the legacy 0.5 scale.

Sheep geometry is corrected to Java 26.1's BabySheepModel.createBodyLayer:
body pivot [0, 7, 0.5], exact leg origins, and no fleece inflation. Java's
LayerDefinitions registers the identical body layer for SHEEP_BABY_WOOL.
Verified against Mojang's Java 26.1 client (SHA-1
191771837687b766537a8c4607cb6fad79c533a1).
