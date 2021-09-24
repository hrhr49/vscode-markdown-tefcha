import * as opentype from 'opentype.js'

import {parse} from 'tefcha/dist/cjs/parser'
import {
  TextSize,
  MeasureTextFunc,
  Shape,
  Text,
  Rect,
  Frame,
  Diamond,
  Path,
} from 'tefcha/dist/cjs/shape'
import {
  Config,
  createFlowchart,
} from 'tefcha'

class RawText {
  type: 'raw' | 'escaped';
  constructor (
    private readonly text: string
  ) {
    this.type = 'raw';
  }

  toString = () => this.text;
}

class EscapedText {
  public readonly type: 'raw' | 'escaped';
  private readonly text: string;
  static readonly ESCAPE_CHARS = new Map<string, string>([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
  ]);

  constructor (
    text: string
  ) {
    this.type = 'escaped';
    this.text = text.replace(/[&<>"]/g, (s: string) => (EscapedText.ESCAPE_CHARS.get(s) || s));
  }

  toString = (): string => this.text;
}


const attrsToString = (attrs: any): string => {
  return Object.entries(attrs || {})
  .map(([k, v]: [string, any]) => `${new EscapedText(k)}="${new EscapedText(String(v))}"`)
  .join(' ');
};

type TagName = (
    'defs'
  | 'g'
  | 'marker'
  | 'path'
  | 'polygon'
  | 'rect'
  | 'svg'
);

class SVGElement {
  constructor (
    private readonly tagName: TagName,
    private readonly attrs: any,
    private readonly children: (SVGElement | RawText | EscapedText)[],
  ) {
  };

  renderAttrs = (): string => attrsToString(this.attrs);

  renderChildren = (): string => (this.children || [])
    .map((child) => String(child))
    .join('');

  toString = (): string => `<${this.tagName} ${this.renderAttrs()}>${this.renderChildren()}</${this.tagName}>`;

  append = (child: RawText | EscapedText | SVGElement): void => {
    this.children.push(child);
  };

  setAttribute = (key: string, value: string): void => {
    this.attrs[key] = value;
  };
}

interface Layers {
  frameLayer: SVGElement;
  textLayer: SVGElement;
  nodeLayer: SVGElement;
  pathLayer: SVGElement;
}

class SvgRenderer {
  readonly svg: SVGElement;
  readonly src: string;
  readonly config: Config;
  readonly font: opentype.Font;

  constructor ({
    src,
    config,
    font,
  }: {
    src: string;
    config: Config;
    font: opentype.Font;
  }) {
    this.src = src;
    this.config = config;
    this.font = font;

    this.svg = this.el('svg', {
      version: '1.1',
      xmlns: 'http://www.w3.org/2000/svg',
    });

  }

  el = (
    tagName: TagName,
    attrs?: any,
    ...children: (SVGElement | RawText | EscapedText)[]
  ): SVGElement => {
    return new SVGElement(tagName, attrs, children);
  };

  measureText: MeasureTextFunc = (
    text: string, attrs: any = {}
  ): TextSize => {
    const _attrs = {...attrs, x: (attrs.x || 0)};
    const fontSize = Number(_attrs['font-size']) || 14;

    let maxX2 = -Infinity, height = 0;

    text.split(/\\n/).forEach((line, idx) => {
      const { x2 } = this.font
        .getPath(line, 0, idx * fontSize, fontSize)
        .getBoundingBox();
      maxX2 = Math.max(maxX2, x2);
      height += fontSize;
    });

    return {w: maxX2, h: height};
  }

  renderShape = ({
    layers,
    shape,
    offsetX = 0,
    offsetY = 0,
  }: {
    layers: Layers;
    shape: Shape;
    offsetX?: number;
    offsetY?: number;
  }): void => {
    const x = offsetX + shape.x;
    const y = offsetY + shape.y;

    switch (shape.type) {
      case 'group':
        shape.children.forEach(child => this.renderShape({layers, shape: child, offsetX: x, offsetY: y}));
        break;
      case 'text':
        layers.textLayer.append(this.renderText({x, y, shape}));
        break;
      case 'path':
        layers.pathLayer.append(this.renderPath({x, y, shape}));
        break;
      case 'rect':
        layers.nodeLayer.append(this.renderRect({x, y, shape}));
        break;
      case 'frame':
        layers.frameLayer.append(this.renderFrame({x, y, shape}));
        break;
      case 'diamond':
        layers.nodeLayer.append(this.renderDiamond({x, y, shape}));
        break;
      case 'point':
        break;
      default:
        const _: never = shape;
        throw `shape ${_} is invalid`;
    }
  };

  renderText = ({
    x,
    y,
    shape,
  }: {
    x: number,
    y: number,
    shape: Text,
  }): RawText => {
    const attrs = shape.isLabel ? this.config.label.attrs : this.config.text.attrs;
    const fontSizeStr = attrs['font-size'];

    let fontSize = 14;
    if (typeof(fontSizeStr) === 'string') {
      if (fontSizeStr.endsWith('px')) {
        fontSize = Number(fontSizeStr.slice(0, -2));
      } else {
        throw 'font-size of text and label should be specified "px" uinit';
      }
    } else {
      throw 'font-size of text and label should be specified "px" uinit';
    }

    const pathList: string[] = [];

    shape.content.split(/\\n/).forEach((line, idx) => {
      const ascenderPx = fontSize * this.font.ascender / ( this.font.ascender - this.font.descender);
      const pathStr = this.font
        .getPath(line, x, y + idx * fontSize + ascenderPx, fontSize)
        .toSVG(2)
        .replace('<path', `<path ${attrsToString(attrs)} `);
      pathList.push(pathStr);
    });

    return new RawText(pathList.join(''));
  }

  renderRect = ({
    x,
    y,
    shape,
  }: {
    x: number,
    y: number,
    shape: Rect,
  }): SVGElement => {
    const {config} = this;
    const {w, h} = shape;
    return this.el('rect', {x, y, width: w, height: h, ...config.rect.attrs})
  }

  renderFrame = ({
    x,
    y,
    shape,
  }: {
    x: number,
    y: number,
    shape: Frame,
  }): SVGElement => {
    const {config} = this;
    const {w, h} = shape;
    return this.el('rect', {x, y, width: w, height: h, ...config.frame.attrs})
  }

  renderDiamond = ({
    x,
    y,
    shape,
  }: {
    x: number,
    y: number,
    shape: Diamond,
  }): SVGElement => {
    const {config} = this;
    const {w, h} = shape;
    return this.el('polygon', {
      points: `${x + w / 2},${y}, ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
      ...config.diamond.attrs,
    })
  }

  renderPath = ({
    x,
    y,
    shape,
  }: {
    x: number,
    y: number,
    shape: Path,
  }): SVGElement => {
    const {config} = this;
    const m = `M ${x} ${y}`;
    const l = shape.cmds.map(cmd => cmd.join(' ')).join(' ');
    //     arrow = 'marker-end="url(#arrow-head)"' if self.is_arrow else ''
    return this.el('path', {
      d: `${m} ${l}`,
      ...(shape.isArrow ?
          {'marker-end': 'url(#arrow-head)'} : {}),
      ...config.path.attrs,
    });
  }

  render = () => {
    let {src, config, el, measureText, renderShape} = this;
    const svg = this.svg;
    const arrowHeadDef = el('defs', null,
      el('marker',
        {
          id: 'arrow-head',
          markerUnits: 'userSpaceOnUse',
          markerWidth: `${config.arrowHead.size}`,
          markerHeight: `${config.arrowHead.size * 2}`,
          viewBox: '0 0 10 10',
          refX: '10',
          refY: '5',
          orient: 'auto-start-reverse',
        },
        el('polygon',
          {
            points: '0,0 0,10 10,5',
            'class': 'arrow-head',
            ...config.arrowHead.attrs,
          }
        )
      )
    );
    svg.append(arrowHeadDef);
    const backgroundLayer = el('g');
    const frameLayer = el('g');
    const pathLayer = el('g');
    const nodeLayer = el('g');
    const textLayer = el('g');

    const flowchart = createFlowchart({
      node: parse(src, config),
      config,
      measureText: measureText,
    });

    renderShape({
      layers: {
        frameLayer,
        pathLayer,
        nodeLayer,
        textLayer,
      },
      shape: flowchart.shapes,
    });

    svg.append(backgroundLayer);
    svg.append(frameLayer);
    svg.append(pathLayer);
    svg.append(nodeLayer);
    svg.append(textLayer);

    // (x, y) have been moved to (0, 0) in createFlowchart().
    const svgX = 0;
    const svgY = 0;
    const svgWidth = flowchart.shapes.w + config.flowchart.marginX * 2;
    const svgHeight = flowchart.shapes.h + config.flowchart.marginY * 2;


    svg.setAttribute('width', String(svgWidth));
    svg.setAttribute('height', String(svgHeight));

    svg.setAttribute('viewBox', `${svgX} ${svgY} ${svgWidth} ${svgHeight}`);
    const backgroundColor = config.flowchart.backgroundColor;
    if (!['', 'none', 'transparent'].includes(backgroundColor)) {
      backgroundLayer.append(el('rect', {x: 0, y: 0, width: svgWidth, height: svgHeight, fill: backgroundColor}));
    }

    return svg;
  };
}

class Renderer {
  readonly src: string;
  readonly config: Config;
  readonly font: opentype.Font;
  readonly svgRenderer: SvgRenderer;

  constructor ({
    src,
    config,
    font,
  }: {
    src: string;
    config: Config;
    font: opentype.Font;
  }) {
    this.src = src;
    this.config = config;
    this.font = font;

    this.svgRenderer = new SvgRenderer({
      src,
      config,
      font,
    });
  }

  renderSvgSync = (): Buffer => {
    return Buffer.from(this.svgRenderer.render().toString());
  }
}


export {
  Renderer,
}

