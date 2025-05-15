import JSZip from "jszip"
import fs from 'fs'
import path from 'path'
import nodeCrypto from "crypto"
import clrc from 'clrc'
import { rimrafSync } from 'rimraf'
import { Document, DOMParser, Element, XMLSerializer } from '@xmldom/xmldom'
import ScratchUID from "scratch-uid"

const color = "" // "#ffffff"

const timeListName = "lyrics.times"
const spriteJsonName = "sprite.json"
const lyricsDir = "lyrics"
const lyricFilePath = path.join(lyricsDir, "lyric.txt")
const tlyricFilePath = path.join(lyricsDir, "tlyric.txt")
const templateDir = "template"
const outputDir = "output"
const outputSpritePath = path.join(outputDir, "lyrics.sprite3")

rimrafSync(outputDir)

const template = {
    sprite: await JSZip.loadAsync(fs.readFileSync(path.join(templateDir, "lyrics.sprite3"))),
    none_svg: fs.readFileSync(path.join(templateDir, "none.svg")).toString(),
    lyric_svg: fs.readFileSync(path.join(templateDir, "lyric.svg")).toString(),
    tlyric_svg: fs.readFileSync(path.join(templateDir, "tlyric.svg")).toString(),
}

function parseSVG(str: string) {
    const parser = new DOMParser()
    return parser.parseFromString(str, "image/svg+xml")
}

function stringifySVG(svg: Document) {
    const serializer = new XMLSerializer()
    return serializer.serializeToString(svg)
}

function md5hex(data: nodeCrypto.BinaryLike) {
    return nodeCrypto.createHash('md5').update(data).digest('hex');
}

const lyrics = (() => {
    function getLRC(filename: string) {
        if (!fs.existsSync(filename))
            return null
        let output = clrc.parse(fs.readFileSync(filename).toString().replaceAll('\r', ''))
        // console.log(output)
        return output.filter((v) => v.type === clrc.LineType.LYRIC)
            .map((v) => ({
                startMillisecond: v.startMillisecond,
                content: v.content.trim(),
                translate: '',
            }))
            .sort((a, b) => a.startMillisecond - b.startMillisecond)
    }
    const lyric = getLRC(lyricFilePath)
    if (!lyric) {
        throw `Error: ${lyricFilePath} does not exists!`
    }
    const tlyric = getLRC(tlyricFilePath)
    if (tlyric) {
        let ti = 0
        for (const v of lyric) {
            if (v.startMillisecond === tlyric[ti].startMillisecond) {
                v.translate = tlyric[ti].content
                ti++
            }
        }
    }
    return lyric
})();

type scratchList = [string, (string | number | boolean)[]]

interface scratchCostume {
    name: string,
    bitmapResolution: number,
    dataFormat: "svg" | "png" | "jpg",
    assetId: string,
    md5ext: string, // "assetId.dataFormat"
    rotationCenterX: number,
    rotationCenterY: number
}

interface scratchSprite {
    lists: { [key: string]: scratchList },
    costumes: scratchCostume[],
}

const sprite = JSON.parse(await template.sprite.file(spriteJsonName)!.async("string")) as scratchSprite

(() => {
    const timeList = lyrics.map((v) => v.startMillisecond / 1000)
    for (const v of Object.values(sprite.lists)) {
        if (v[0] === timeListName) {
            v[1] = timeList
            return
        }
    }
    sprite.lists[ScratchUID()] = [timeListName, timeList]
})();

sprite.costumes = []

const outputSpriteZip = new JSZip()

function addSVG(data: string) {
    const fileMD5 = md5hex(data)
    const dataFormat = 'svg'
    const fileName = fileMD5 + '.' + dataFormat
    outputSpriteZip.file(fileName, data)
    sprite.costumes.push({
        name: String(sprite.costumes.length + 1),
        bitmapResolution: 1,
        assetId: fileMD5,
        dataFormat,
        md5ext: fileName,
        rotationCenterX: 240,
        rotationCenterY: 180,
    })
}

function replaceNodeText(tspan: Element, content: string) {
    tspan.textContent = content
    if (color) {
        const attrName = "fill"
        tspan.removeAttribute(attrName)
        const text = tspan.parentElement
        text.removeAttribute(attrName)
        const g = text.parentElement
        g.setAttribute(attrName, color)
    }
}

addSVG(template.none_svg)

for (const v of lyrics) {
    console.log(v.startMillisecond / 1000)
    console.log(v.content)
    let svg: Document
    if (v.translate) {
        console.log(v.translate)
        svg = parseSVG(template.tlyric_svg)
        const tspanList = svg.getElementsByTagName('tspan')
        replaceNodeText(tspanList[0], v.content)
        replaceNodeText(tspanList[1], v.translate)
    } else if (v.content) {
        svg = parseSVG(template.lyric_svg)
        const tspanList = svg.getElementsByTagName('tspan')
        replaceNodeText(tspanList[0], v.content)
    }
    addSVG(svg ? stringifySVG(svg) : template.none_svg)
    console.log()
}

outputSpriteZip.file(spriteJsonName, JSON.stringify(sprite))

fs.mkdirSync(outputDir)
fs.writeFileSync(
    outputSpritePath,
    await outputSpriteZip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
    })
)
