/** Fixed actions for the checked-in creative UI catalog; never user project code. */
export const advancedCreativeProbes = [
  {
    id: 'aora-expression-lab',
    coverViewport: { width: 1100, height: 1000 },
    capture: [{ type: 'click', selector: '#emotion-list [data-emotion-id="10"]' }],
    actions: [],
    statusSelector: '#interaction-status',
    stageSelector: '#expression-stage',
  },
  {
    id: 'orbital-route',
    actions: [
      {
        type: 'select',
        selector: '#destination',
        value: '2',
        expected: '悉尼',
      },
      {
        type: 'click',
        selector: '#night',
        expected: '夜航',
      },
      {
        type: 'click',
        selector: '#dispatch',
        expected: '已记录 1 条',
      },
    ],
    capture: [
      {
        type: 'select',
        selector: '#destination',
        value: '1',
      },
      {
        type: 'click',
        selector: '#night',
      },
      {
        type: 'range',
        selector: '#altitude',
        value: 36,
      },
    ],
    statusSelector: '#status',
    stageSelector: '.stage',
  },
  {
    id: 'aurora-spectrum',
    actions: [
      {
        type: 'select',
        selector: '#palette',
        value: '1',
        expected: '光谱',
      },
      {
        type: 'range',
        selector: '#density',
        value: 10,
        expected: '10 层条带',
      },
      {
        type: 'range',
        selector: '#gain',
        value: 110,
        expected: '增益 110%',
      },
      {
        type: 'click',
        selector: '#shutter',
        expected: '画面冻结',
      },
    ],
    capture: [
      {
        type: 'select',
        selector: '#palette',
        value: '0',
      },
      {
        type: 'range',
        selector: '#gain',
        value: 112,
      },
      {
        type: 'range',
        selector: '#density',
        value: 9,
      },
    ],
    statusSelector: '#status',
    stageSelector: '.stage',
  },
  {
    id: 'contour-atlas',
    actions: [
      {
        type: 'click',
        selector: '#seed',
        expected: '种子 25',
      },
      {
        type: 'range',
        selector: '#sea',
        value: 52,
        expected: '海平面 52%',
      },
      {
        type: 'click',
        selector: '#transect',
        expected: '剖面线开启',
      },
      {
        type: 'select',
        selector: '#mapmode',
        value: '1',
        expected: '测绘',
      },
    ],
    capture: [
      {
        type: 'range',
        selector: '#sea',
        value: 38,
      },
      {
        type: 'click',
        selector: '#transect',
      },
    ],
    statusSelector: '#status',
    stageSelector: '.stage',
  },
  {
    id: 'curve-corridor',
    actions: [
      {
        type: 'select',
        selector: '#route',
        value: '2',
        expected: '螺旋跃迁',
      },
      {
        type: 'range',
        selector: '#speed',
        value: 75,
        expected: '速度 75%',
      },
      {
        type: 'select',
        selector: '#segments',
        value: '4',
        expected: '4 边截面',
      },
      {
        type: 'click',
        selector: '#checkpoint',
        expected: '记录 1',
      },
    ],
    capture: [
      {
        type: 'select',
        selector: '#route',
        value: '0',
      },
      {
        type: 'select',
        selector: '#segments',
        value: '8',
      },
      {
        type: 'click',
        selector: '#align',
      },
    ],
    statusSelector: '#status',
    stageSelector: '.stage',
  },
  {
    id: 'chromatic-archive',
    actions: [
      {
        type: 'click',
        selector: '#next',
        expected: '日落折叠',
      },
      {
        type: 'range',
        selector: '#depth',
        value: 70,
        expected: '景深 70%',
      },
      {
        type: 'click',
        selector: '#explain',
        expected: '解读已展开',
      },
      {
        type: 'click',
        selector: '#previous',
        expected: '海洋频率',
      },
    ],
    capture: [
      {
        type: 'select',
        selector: '#artwork',
        value: '1',
      },
      {
        type: 'range',
        selector: '#depth',
        value: 60,
      },
    ],
    statusSelector: '#status',
    stageSelector: '.stage',
  },
  {
    id: 'orbital-exhibition',
    actions: [
      {
        type: 'click',
        selector: '#right',
        expected: '当前作品 2 / 8',
      },
      {
        type: 'range',
        selector: '#radius',
        value: 250,
        expected: '环半径 250 px',
      },
      {
        type: 'range',
        selector: '#tilt',
        value: 12,
        expected: '俯仰 12°',
      },
      {
        type: 'click',
        selector: '#focus',
        expected: '聚焦视图',
      },
    ],
    capture: [
      {
        type: 'range',
        selector: '#radius',
        value: 160,
      },
      {
        type: 'range',
        selector: '#tilt',
        value: -8,
      },
    ],
    statusSelector: '#status',
    stageSelector: '.stage',
  },
  {
    id: 'liquid-optics',
    actions: [
      {
        type: 'select',
        selector: '#profile',
        value: '2',
        expected: '轮廓 n=2',
      },
      {
        type: 'range',
        selector: '#refraction',
        value: 75,
        expected: '折射 75%',
      },
      {
        type: 'range',
        selector: '#dispersion',
        value: 14,
        expected: '色散 14 px',
      },
      {
        type: 'click',
        selector: '#background',
        expected: '建筑网格',
      },
      {
        type: 'click',
        selector: '#compare',
        expected: '原画对照',
      },
      {
        type: 'click',
        selector: '#compare',
        expected: '透镜效果',
      },
    ],
    capture: [
      {
        type: 'select',
        selector: '#profile',
        value: '4',
      },
      {
        type: 'range',
        selector: '#refraction',
        value: 60,
      },
      {
        type: 'range',
        selector: '#dispersion',
        value: 10,
      },
    ],
    statusSelector: '#status',
    stageSelector: '.stage',
  },
  {
    id: 'signal-workflow',
    capture: [
      {
        type: 'click',
        selector: '#run',
      },
    ],
    actions: [
      {
        type: 'fill',
        selector: '#parameter',
        value: '4',
      },
      {
        type: 'click',
        selector: '#run',
        expect: {
          selector: '#result',
          text: '48',
        },
      },
      {
        type: 'click',
        selector: '#add',
        expect: {
          selector: '#nodes .flow-node',
          count: 4,
        },
      },
      {
        type: 'select',
        selector: '#operation',
        value: 'add',
      },
      {
        type: 'fill',
        selector: '#parameter',
        value: '7',
      },
      {
        type: 'click',
        selector: '#run',
        expect: {
          selector: '#result',
          text: '55',
        },
      },
    ],
    coverViewport: {
      width: 1200,
      height: 1000,
    },
  },
  {
    id: 'storyboard-canvas',
    capture: [],
    actions: [
      {
        type: 'select',
        selector: '#fill',
        value: '#d8cce7',
      },
      {
        type: 'fill',
        selector: '#caption',
        value: '新一轮发现',
      },
      {
        type: 'press',
        selector: '#caption',
        value: 'Tab',
        expect: {
          selector: '#selection',
          text: '新一轮发现',
        },
      },
      {
        type: 'click',
        selector: '#duplicate',
        expect: {
          selector: '#count',
          text: '7 个元素',
        },
      },
      {
        type: 'click',
        selector: '#undo',
        expect: {
          selector: '#count',
          text: '6 个元素',
        },
      },
      {
        type: 'click',
        selector: '#zoom-out',
        expect: {
          selector: '#zoom',
          text: '85%',
        },
      },
    ],
    coverViewport: {
      width: 1200,
      height: 1000,
    },
  },
  {
    id: 'orbital-desktop',
    capture: [
      {
        type: 'click',
        selector: '#arrange',
      },
    ],
    actions: [
      {
        type: 'click',
        selector: '[data-space="focus"]',
        expect: {
          selector: '#os-status',
          text: '1 个窗口 · 专注模式',
        },
      },
      {
        type: 'fill',
        selector: '#notes',
        value: '窗口状态彼此独立。',
        expect: {
          selector: '#note-count',
          text: '9 字',
        },
      },
      {
        type: 'click',
        selector: '[data-space="explore"]',
        expect: {
          selector: '#os-status',
          text: '3 个窗口 · 探索模式',
        },
      },
      {
        type: 'click',
        selector: '[data-close="signal"]',
        expect: {
          selector: '#os-status',
          text: '2 个窗口 · 探索模式',
        },
      },
      {
        type: 'click',
        selector: '[data-launch="signal"]',
      },
      {
        type: 'click',
        selector: '[data-band="beta"]',
        expect: {
          selector: '#band-label',
          text: 'BETA',
        },
      },
    ],
    coverViewport: {
      width: 1200,
      height: 1000,
    },
  },
  {
    id: 'navigation-command',
    capture: [],
    actions: [
      {
        type: 'click',
        selector: '#open-command',
      },
      {
        type: 'fill',
        selector: '#command-search',
        value: '遥测',
      },
      {
        type: 'press',
        selector: '#command-search',
        value: 'Enter',
        expect: {
          selector: '#panel-title',
          text: '倾听飞船的脉搏',
        },
      },
      {
        type: 'click',
        selector: '[data-panel="navigation"]',
      },
      {
        type: 'click',
        selector: '[data-sector="lyra"]',
        expect: {
          selector: '#sector-name',
          text: 'LYRA',
        },
      },
      {
        type: 'click',
        selector: '#scan',
        expect: {
          selector: '#scan-status',
          text: '已标记',
        },
      },
      {
        type: 'click',
        selector: '#jump',
        expect: {
          selector: '#distance',
          text: '156.4 AU',
        },
      },
      {
        type: 'click',
        selector: '[data-panel="archive"]',
        expect: {
          selector: '#archive-list li',
          count: 4,
        },
      },
    ],
    coverViewport: {
      width: 1200,
      height: 1000,
    },
  },
  {
    id: 'specimen-archive',
    capture: [],
    actions: [
      {
        type: 'fill',
        selector: '#archive-search',
        value: '花序',
        expect: {
          selector: '#visible-count',
          text: '1 件匹配',
        },
      },
      {
        type: 'click',
        selector: '[data-id="3"] button',
        expect: {
          selector: '#specimen-title',
          text: '花序 03',
        },
      },
      {
        type: 'fill',
        selector: '#rename-input',
        value: '花序 / Phase 03',
      },
      {
        type: 'click',
        selector: '#rename',
        expect: {
          selector: '#specimen-title',
          text: '花序 / Phase 03',
        },
      },
      {
        type: 'fill',
        selector: '#archive-search',
        value: '',
      },
      {
        type: 'click',
        selector: '#move',
        expect: {
          selector: '#specimen-folder',
          text: '已归档',
        },
      },
      {
        type: 'click',
        selector: '#move',
        expect: {
          selector: '#specimen-folder',
          text: '形态研究',
        },
      },
    ],
    coverViewport: {
      width: 1200,
      height: 1000,
    },
  },
  {
    id: 'sequence-director',
    capture: [
      {
        type: 'range',
        selector: '#scrub',
        value: 3.2,
      },
    ],
    actions: [
      {
        type: 'fill',
        selector: '#clip-start',
        value: '1',
      },
      {
        type: 'fill',
        selector: '#clip-end',
        value: '5',
      },
      {
        type: 'click',
        selector: '#apply-trim',
        expect: {
          selector: '#clip-status',
          text: '修剪已应用：1.0 – 5.0 秒。',
        },
      },
      {
        type: 'range',
        selector: '#scrub',
        value: 3,
      },
      {
        type: 'click',
        selector: '#split',
        expect: {
          selector: '#clip-count',
          text: '7 段视觉片段',
        },
      },
      {
        type: 'select',
        selector: '#scale',
        value: '12',
      },
      {
        type: 'click',
        selector: '#add-clip',
        expect: {
          selector: '#clip-count',
          text: '8 段视觉片段',
        },
      },
    ],
    coverViewport: {
      width: 1200,
      height: 1000,
    },
  },
  {
    id: 'screen-sculptor',
    capture: [
      {
        type: 'select',
        selector: '#theme',
        value: 'iris',
      },
    ],
    actions: [
      {
        type: 'fill',
        selector: '#part-label',
        value: '打开灵感详情',
      },
      {
        type: 'press',
        selector: '#part-label',
        value: 'Tab',
        expect: {
          selector: '#part-title',
          text: '打开灵感详情',
        },
      },
      {
        type: 'select',
        selector: '#part-shape',
        value: 'square',
      },
      {
        type: 'select',
        selector: '#theme',
        value: 'sage',
      },
      {
        type: 'click',
        selector: '#preview-mode',
      },
      {
        type: 'click',
        selector: '[data-id="3"]',
        expect: {
          selector: '#current-screen',
          text: '02 / 详情页面',
        },
      },
      {
        type: 'click',
        selector: '[data-id="7"]',
        expect: {
          selector: '#current-screen',
          text: '01 / 灵感首页',
        },
      },
      {
        type: 'click',
        selector: '#preview-mode',
      },
      {
        type: 'click',
        selector: '[data-part="chip"]',
        expect: {
          selector: '#part-count',
          text: '2 屏幕 / 8 组件',
        },
      },
      {
        type: 'click',
        selector: '#make-brief',
        expect: {
          selector: '#design-status',
          text: '实现说明已生成。',
        },
      },
    ],
    coverViewport: {
      width: 1200,
      height: 1000,
    },
  },
  {
    id: 'nocturne-sequencer',
    statusSelector: '#status',
    stageSelector: '.stage',
    actions: [
      {
        type: 'select',
        selector: '#preset',
        value: 'glass',
        assertSelector: '#notes',
        expected: '15',
      },
      {
        type: 'click',
        selector: '.trackname[aria-label="SNARE 静音"]',
        assertSelector: '#audible',
        expected: '3 / 4',
      },
      {
        type: 'range',
        selector: '#tempo',
        value: 137,
        assertSelector: '#bpm',
        expected: '137',
      },
      {
        type: 'click',
        selector: '#play',
        assertSelector: '#play',
        expected: '■ 停止',
      },
      {
        type: 'click',
        selector: '#play',
        assertSelector: '#status',
        expected: '已停止',
      },
    ],
    capture: [
      {
        type: 'select',
        selector: '#preset',
        value: 'glass',
      },
      {
        type: 'range',
        selector: '#tempo',
        value: 128,
      },
    ],
  },
  {
    id: 'orbital-archive',
    statusSelector: '#charttitle',
    stageSelector: '.stage',
    actions: [
      {
        type: 'click',
        selector: '[data-chapter="1"]',
        assertSelector: '#count',
        expected: '16',
      },
      {
        type: 'range',
        selector: '#year',
        value: 2026,
        assertSelector: '#count',
        expected: '8',
      },
      {
        type: 'select',
        selector: '#family',
        value: 'blue',
        assertSelector: '#count',
        expected: '8',
      },
      {
        type: 'click',
        selector: '#sky [role="button"]',
        first: true,
        assertSelector: '#specimen',
        expected: 'N-002',
      },
    ],
    capture: [
      {
        type: 'click',
        selector: '[data-chapter="0"]',
      },
    ],
  },
  {
    id: 'circular-energy',
    statusSelector: '#balance',
    stageSelector: '.stage',
    actions: [
      {
        type: 'click',
        selector: '[data-plan="future"]',
        assertSelector: '#carbon',
        expected: '9.9',
      },
      {
        type: 'click',
        selector: '#loop',
        assertSelector: '#flowname',
        expected: '产业 → 余热回流',
      },
      {
        type: 'range',
        selector: '#recovery',
        value: 40,
        assertSelector: '#recapture',
        expected: '13.2',
      },
      {
        type: 'range',
        selector: '#demand',
        value: 120,
        assertSelector: '#balance',
        expected: '主干流入 120.0 = 使用 108.0 + 损耗 12.0',
      },
    ],
    capture: [
      {
        type: 'click',
        selector: '[data-plan="future"]',
      },
    ],
  },
  {
    id: 'isometric-city',
    statusSelector: '#status',
    stageSelector: '.stage',
    actions: [
      {
        type: 'select',
        selector: '#parcel',
        value: '16',
        assertSelector: '#lot',
        expected: 'C3',
      },
      {
        type: 'click',
        selector: '[data-kind="work"]',
        assertSelector: '#selection',
        expected: '当前用途：工作室',
      },
      {
        type: 'changeRange',
        selector: '#height',
        value: 5,
        assertSelector: '#heightout',
        expected: '5F',
      },
      {
        type: 'click',
        selector: '#night',
        assertSelector: '#viewlabel',
        expected: 'MOONLIGHT',
      },
      {
        type: 'click',
        selector: '#green',
        assertSelector: '#viewlabel',
        expected: 'GREEN COVERAGE',
      },
      {
        type: 'click',
        selector: '#undo',
        assertSelector: '#status',
        expected: '已撤销',
      },
    ],
    capture: [
      {
        type: 'select',
        selector: '#parcel',
        value: '32',
      },
      {
        type: 'click',
        selector: '[data-kind="work"]',
      },
      {
        type: 'changeRange',
        selector: '#height',
        value: 5,
      },
    ],
  },
  {
    id: 'contour-sculpture',
    statusSelector: '#plateinfo',
    stageSelector: '.stage',
    actions: [
      {
        type: 'select',
        selector: '#feature',
        value: '1',
        assertSelector: '#coordinates',
        expected: '460 / 245',
      },
      {
        type: 'range',
        selector: '#height',
        value: 80,
        assertSelector: '#heightout',
        expected: '80',
      },
      {
        type: 'click',
        selector: '[data-dx="10"]',
        assertSelector: '#coordinates',
        expected: '470 / 245',
      },
      {
        type: 'range',
        selector: '#layers',
        value: 35,
        assertSelector: '#pathcount',
        expected: '35',
      },
      {
        type: 'click',
        selector: '#window',
        assertSelector: '#terrain text',
        expected: 'NEGATIVE SPACE',
      },
      {
        type: 'click',
        selector: '#ink',
        assertSelector: '#plateinfo',
        expected: 'COPPER',
      },
    ],
    capture: [
      {
        type: 'click',
        selector: '#handles',
      },
      {
        type: 'range',
        selector: '#layers',
        value: 35,
      },
    ],
  },
  {
    id: 'knowledge-canopy',
    statusSelector: '#visiblecount',
    stageSelector: '.stage',
    actions: [
      {
        type: 'fill',
        selector: '#search',
        value: '光线',
        assertSelector: '#searchstatus',
        expected: '1 个匹配',
      },
      {
        type: 'click',
        selector: '#results button',
        first: true,
        assertSelector: '#nodetitle',
        expected: '光线节奏',
      },
      {
        type: 'click',
        selector: '#focus',
        assertSelector: '#visiblecount',
        expected: '8 VISIBLE NODES',
      },
      {
        type: 'click',
        selector: '#layout',
        assertSelector: '#layout',
        expected: '切换星图',
      },
      {
        type: 'select',
        selector: '#topic',
        value: 'system',
        assertSelector: '#maptitle',
        expected: '有温度的服务系统',
      },
      {
        type: 'click',
        selector: '#collapse',
        assertSelector: '#visiblecount',
        expected: '4 VISIBLE NODES',
      },
    ],
    capture: [
      {
        type: 'click',
        selector: '#expand',
      },
    ],
  },
];
