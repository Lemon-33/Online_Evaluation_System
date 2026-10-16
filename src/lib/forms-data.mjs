// 14 个岗位的题目定义（数据源 / 单一真源）
// 用法：node scripts/forms-export.mjs   → 输出桌面 岗位表单定义.xlsx
// 结构：每个岗位 = { , sections: [基础履职, 提质赋分, 履职扣分] }
//   选择题：{ key, label, options: [{value, label, score}] }
//   填空题：{ key, label, type: 'fill', unitScore, unit }
//        ——unitScore 是每单位得分（可正可负），unit 是中文单位（项/次/人次/张/起/件）
//        ——得分 = 数量 × unitScore
// ----------------------------------------------------------------

export const y = (score) => [
  { value: 'yes', label: '满足', score },
  { value: 'no',  label: '不满足', score: 0 },
];
export const has = (score) => [
  { value: 'yes', label: '有', score },
  { value: 'no',  label: '无', score: 0 },
];
export const rankPro4 = () => [
  { value: 'r1', label: '排名第一', score: 10 },
  { value: 'r2', label: '排名第二', score: 8 },
  { value: 'r3', label: '排名第三', score: 0 },
  { value: 'r4', label: '排名第四', score: 0 },
];
export const rankLead3 = () => [
  { value: 'r1', label: '排名第一', score: 10 },
  { value: 'r2', label: '排名第二', score: 8 },
  { value: 'r3', label: '排名第三', score: 6 },
];
export const rankLead3_0 = () => [
  { value: 'r1', label: '排名第一', score: 10 },
  { value: 'r2', label: '排名第二', score: 8 },
  { value: 'r3', label: '排名第三', score: 0 },
  { value: 'r4', label: '排名第四', score: 0 },
];

// 只改选项的分值 / 文案（不用整段重写 options 数组）
//   用法：patchOptions(rankPro4(), { r1: { score: 15 }, r2: { label: '第二名（保留）' } })
//   未出现在 patch 里的选项原样保留
export const patchOptions = (options, patch = {}) =>
  (options || []).map((o) => (patch[o.value] ? { ...o, ...patch[o.value] } : o));

// 填空题字段（spread 到 item 上）
//   hasReason = true 时：自评页会在数量输入框下方再渲染一个 textarea（"请说明为什么得分"），
//                   员工填写原因后与数量一起以 {count, reason} 形式存到 evaluation.scores.answers；
//                   审核页会把这个 reason 作为只读字段展示，审核人可改数量但不能改 reason。
//   单独某道题想要"不要求原因"：在 forms-data.mjs 里那一项上 spread ...fill(..., ...)，再覆盖 hasReason:false
export const fill = (unitScore, unit = '项') => ({ type: 'fill', unitScore, unit, hasReason: true });

export const POSITION_FORMS = {
  // ============== 一、专业技术岗位（4 个） ==============
  distributionTech: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求完成配电网网架规划、成资本项目储备、评审、上报、网架问题治理、配电台区超重载、配变越限治理、10千伏线路线损指标管控、配电自动化布点、自动化设备消缺、三大类缺陷（树线、绝缘裸露点、局放异常）消缺、发电作业、停电计划上报、数据质量治理等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '攻克技术难题、优化技术方案、压降设备故障、供电可靠性提升、代维驻点建设等专业管理经验被上级公司肯定或推广', ...fill(5, '项') },
          { key: 'q2', label: '牵头完成中心布置的急难险重专项任务', ...fill(5, '项') },
          { key: 'q3', label: '牵头制定中心各项内控制度、管理办法、实施方案等', ...fill(5, '项') },
          { key: 'q4', label: '负责的专业领域指标在主城区四个中心排名', options: rankPro4() },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1', label: '因工作作风敷衍、拖沓等主观因素，造成技术研判失误、方案疏漏、技术支撑不到位等情形，导致工作滞后、问题频发', ...fill(-5, '次') },
          { key: 'd2', label: '专业管理不到位导致发生有责投诉', ...fill(-5, '件') },
          { key: 'd3', label: '负责的专业领域指标在主城区四个中心连续两个月排名末位', ...fill(-5, '项') },
          { key: 'd4', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  marketingTech: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求完成高、低压业扩报装、业扩配套、电价执行、电费回收、台区线损指标管控、计量采集、表计轮换、光伏并网、分布式光伏"四可"建设、工单办理、网格服务、专业稽查等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '攻克民生服务难题、优化服务模式、压降服务意见、投诉工单数量、服务满意度提升等专业管理经验被上级公司肯定或推广', ...fill(5, '项') },
          { key: 'q2', label: '牵头完成中心布置的急难险重专项任务', ...fill(5, '项') },
          { key: 'q3', label: '牵头制定中心各项内控制度、管理办法、实施方案等', ...fill(5, '项') },
          { key: 'q4', label: '负责的专业领域指标在主城区四个中心排名', options: rankPro4() },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1', label: '因上级公司专业管理要求宣贯不及时，导致工作滞后', ...fill(-5, '次') },
          { key: 'd2', label: '因上级公司专业管理要求执行监督不到位，导致被上级公司或外部监管检查发现有人员直接责任违规事件', ...fill(-10, '件') },
          { key: 'd3', label: '专业稽查工作开展不到位，导致产生增量的一址多户、电价执行错误等问题', ...fill(-5, '件') },
          { key: 'd4', label: '专业管理不到位导致发生有责投诉', ...fill(-5, '件') },
          { key: 'd5', label: '负责的专业领域指标在主城区四个中心连续两个月排名末位', ...fill(-5, '项') },
          { key: 'd6', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  engineeringTech: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求完成配网成、资本项目项目预算执行率、投资完成率、项目关闭率、结决算报审、转资、物资库存压降等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '攻克配电网建设难题、优化工程技术方案、压降库存物资、转资综合质量达标率高等专业管理经验被上级公司肯定或推广', ...fill(5, '项') },
          { key: 'q2', label: '牵头完成中心布置的急难险重专项任务', ...fill(5, '项') },
          { key: 'q3', label: '牵头制定中心各项内控制度、管理办法、实施方案等', ...fill(5, '项') },
          { key: 'q4', label: '负责的专业领域指标在主城区四个中心排名', options: rankPro4() },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1', label: '因上级公司专业管理要求执行不到位，导致相关问题发生', ...fill(-5, '项') },
          { key: 'd2', label: '因专业管理不到位被上级公司各类检查发现有人员直接责任违规事件', ...fill(-10, '件') },
          { key: 'd3', label: '负责的专业领域指标在主城区四个中心连续两个月排名末位', ...fill(-5, '项') },
          { key: 'd4', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  generalAffairs: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求完成党建、纪检、团青、工会、宣传、统战、教育培训、信息安全、劳资管理、综合文秘等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '牵头开展的党建赋能业务、支部三级堡垒创建、党员专项行动、党建片区管理、党员监督教育、党员服务队建设、青年员工"334"培优、先进典型选树培育、员工思想动态调研、我为职工办实事、企业文化建设等工作，提炼的典型经验或形成的实践案例被上级公司肯定或交流推广', ...fill(5, '项') },
          { key: 'q2', label: '牵头完成中心布置的专项工作专报', ...fill(5, '项') },
          { key: 'q3', label: '牵头制定中心各项内控制度、管理办法、实施方案等', ...fill(5, '项') },
          { key: 'q4', label: '牵头组织开展"主题党日"、党员志愿服务、"尚德四礼"、青工培训、职工文体等活动', ...fill(3, '项') },
          { key: 'q5a', label: '保供电、优服务、促发展、惠民生等供服工作，以及党建、纪检、团青、工会、统战等工作在苏电融媒体矩阵宣传', ...fill(3, '项') },
          { key: 'q5b', label: '在系统外主流媒体宣传', ...fill(5, '项') },
          { key: 'q5c', label: '在三大央媒宣传', ...fill(10, '项') },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1', label: '因上级公司专业管理要求宣贯不及时，导致工作滞后', ...fill(-5, '次') },
          { key: 'd2', label: '因上级公司专业管理要求执行不到位，导致相关问题发生', ...fill(-5, '次') },
          { key: 'd3', label: '因专业管理不到位被上级公司各类检查发现有人员直接责任不合规事项', ...fill(-10, '件') },
          { key: 'd4', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  // ============== 二、班组长岗位（5 个） ==============
  businessTeamLeader: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求开展营业厅规范服务、资金安全管控、网络信息安全等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '月度 95598 工单回访满意率高于 98%', options: has(5) },
          { key: 'q2', label: '营业厅服务获客户表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q3', label: '提出优化服务模式合理化建议被采纳实施并产生实效', ...fill(5, '项') },
          { key: 'q4', label: '营业厅业务外包人员在客户服务工作中获得中心层面季度、年度表彰', ...fill(3, '人次') },
          { key: 'q5a', label: '营业厅服务客户工作在苏电融媒体矩阵宣传', ...fill(3, '项') },
          { key: 'q5b', label: '在系统外主流媒体宣传', ...fill(5, '项') },
          { key: 'q5c', label: '在三大央媒宣传', ...fill(10, '项') },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '营业厅因人员履职不当、服务不规范、态度恶劣等引发优质服务意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '营业厅因人员履职不当、服务不规范、态度恶劣等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '月度 95598 工单回访满意率低于 98%', options: has(-2) },
          { key: 'd3', label: '因班组管理工作不到位，造成营业厅在上级公司或外部监管检查中发现有人员直接责任的违规事项', ...fill(-10, '件') },
          { key: 'd4', label: '未按要求开展班组安全学习、"三指定"警示教育、服务规范培训等工作', ...fill(-5, '次') },
          { key: 'd5', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  keyAccountTeamLeader: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求开展班组高压业扩报装、业扩配套、用电检查、电费回收、工单办理、安全管理、电力保供等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '月度 95598 工单回访满意率高于 98%', options: has(5) },
          { key: 'q2', label: '班组业扩报装、用电检查、电力保供等工作获客户表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q3', label: '提出优化服务流程、营商环境提升等工作的合理化建议被采纳实施并产生实效', ...fill(5, '项') },
          { key: 'q4', label: '牵头完成中心布置的急难险重专项任务或推动历史遗留问题解决', ...fill(5, '项') },
          { key: 'q5', label: '班组成员在供电服务工作中获得中心层面季度、年度表彰', ...fill(3, '人次') },
          { key: 'q6a', label: '优化营商环境等工作在苏电融媒体矩阵宣传', ...fill(3, '项') },
          { key: 'q6b', label: '在系统外主流媒体宣传', ...fill(5, '项') },
          { key: 'q6c', label: '在三大央媒宣传', ...fill(10, '项') },
          { key: 'q7', label: '班组承担的电费回收率、业扩报装服务时限达标率等专业考核指标在主城区六个分部排名', options: rankLead3() },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '班组因人员履职不当、流程超期、态度恶劣等引发优质服务意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '班组因人员履职不当、流程超期、态度恶劣等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '月度 95598 工单回访满意率低于 98%', options: has(-2) },
          { key: 'd3', label: '上级公司下发的专业稽查工单处理不及时，每超期一张扣 5 分', ...fill(-5, '张') },
          { key: 'd4', label: '班组承担的专业考核指标在主城区六个分部连续两个月排名末位', ...fill(-5, '项') },
          { key: 'd5', label: '班组用检专业出现临时用电超期、定比定量核定超期、暂停减容超期等情形', ...fill(-3, '项') },
          { key: 'd6', label: '因班组日常监督管理工作不到位，造成在上级公司或外部监管检查中发现有人员直接责任的违规事项', ...fill(-10, '件') },
          { key: 'd7', label: '未按要求开展班组安全学习、"三指定"警示教育、服务规范培训等工作', ...fill(-5, '次') },
          { key: 'd8', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  lvIntegratedTeamLeader: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求开展班组低压业扩报装、用电检查、网格服务、光伏并网、表计轮换、表箱改造、低压用采、低压台区线损、电费回收、工单办理、安全管理、电力保供等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '月度 95598 工单回访满意率高于 98%', options: has(5) },
          { key: 'q2', label: '月度区域服务网格零投诉', options: has(5) },
          { key: 'q3', label: '班组业扩报装、网格服务、用电诉求办理等工作获客户表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q4', label: '提出优化服务模式、提升网格服务质效、压降工单数量等工作的合理化建议被采纳实施并产生实效', ...fill(5, '项') },
          { key: 'q5', label: '牵头完成中心布置的急难险重专项任务或推动历史遗留问题解决', ...fill(5, '项') },
          { key: 'q6', label: '班组成员在供电服务工作中获得中心层面季度、年度表彰', ...fill(3, '人次') },
          { key: 'q7a', label: '为民办实事、推动群众急难愁盼用电难题解决等工作在苏电融媒体矩阵宣传', ...fill(3, '项') },
          { key: 'q7b', label: '在系统外主流媒体宣传', ...fill(5, '项') },
          { key: 'q7c', label: '在三大央媒宣传', ...fill(10, '项') },
          { key: 'q8', label: '班组承担的电费回收率、业扩报装服务时限达标率、台区管理线损达标率、低压用户采集成功率、表计轮换进度等专业考核指标在主城区六个分部排名', options: rankLead3() },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '班组因人员履职不当、流程超期、态度恶劣等引发优质服务意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '班组因人员履职不当、流程超期、态度恶劣等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '月度 95598 工单回访满意率低于 98%', options: has(-2) },
          { key: 'd3', label: '上级公司下发的专业稽查工单处理不及时，每超期一张扣 5 分', ...fill(-5, '张') },
          { key: 'd4', label: '班组承担的专业考核指标在主城区六个分部连续两个月排名末位', ...fill(-5, '项') },
          { key: 'd5', label: '班组用检专业出现临时用电超期等情形', ...fill(-3, '项') },
          { key: 'd6a', label: '作业现场中心层面查见的一般违章', ...fill(-1, '次') },
          { key: 'd6b', label: '作业现场市公司层面查见的一般违章', ...fill(-3, '次') },
          { key: 'd6c', label: '作业现场网省公司层面查见的一般违章', ...fill(-5, '次') },
          { key: 'd6d', label: '作业现场被上级公司查见通报的严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd7', label: '因班组日常监督管理工作不到位，造成在上级公司或外部监管检查中发现有人员直接责任的违规事项', ...fill(-10, '件') },
          { key: 'd8', label: '未按要求开展班组安全学习、"三指定"警示教育、服务规范培训、客户基础档案数据梳理等工作', ...fill(-5, '次') },
          { key: 'd9', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  distributionOperationTeamLeader: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求开展班组负责辖区 10（20）千伏及以下配电网设备的巡视、检修、故障抢修、缺陷消缺、隐患排查治理，保障配电网安全可靠供电，同时承担配网相关现场作业、验收、安全防护等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '月度 95598 工单回访满意率高于 98%', options: has(5) },
          { key: 'q2', label: '月度区域未发生 10（20）千伏线路故障', options: has(5) },
          { key: 'q3', label: '班组故障抢修、应急消险、防汛防台、重大活动保电等工作获属地政府或客户表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q4', label: '提出故障压降、频繁停电治理、提升故障抢修质效等工作的合理化建议被采纳实施并产生实效', ...fill(5, '项') },
          { key: 'q5', label: '牵头完成中心布置的急难险重专项任务或推动历史遗留问题解决', ...fill(5, '项') },
          { key: 'q6', label: '班组成员在电力保供、安全生产、精益运维等工作中获得中心层面季度、年度表彰', ...fill(3, '人次') },
          { key: 'q7a', label: '提升供电可靠性等工作在苏电融媒体矩阵宣传', ...fill(3, '项') },
          { key: 'q7b', label: '在系统外主流媒体宣传', ...fill(5, '项') },
          { key: 'q7c', label: '在三大央媒宣传', ...fill(10, '项') },
          { key: 'q8', label: '班组承担的中压供电可靠率、百公里故障率、重复故障数、重复故障复发数、故障压降率、频繁停电投诉工单数、多次停电意见工单数等专业考核指标在主城区六个分部排名', options: rankLead3() },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '班组因人员履职不到位造成故障抢修时间长、频繁停电等引发意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '班组因人员履职不到位造成故障抢修时间长、频繁停电等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '月度 95598 工单回访满意率低于 98%', options: has(-2) },
          { key: 'd3', label: '不在控缺陷引起的故障停电', ...fill(-5, '起') },
          { key: 'd4', label: '线路通道隐患点防控措施落实不到位引起的外破停电', ...fill(-5, '起') },
          { key: 'd5', label: '班组承担的专业考核指标在主城区六个分部连续两个月排名末位', ...fill(-5, '项') },
          { key: 'd6a', label: '班组成员工作许可制度执行不到位——中心层面一般违章', ...fill(-1, '次') },
          { key: 'd6b', label: '班组成员工作许可制度执行不到位——市公司层面一般违章', ...fill(-3, '次') },
          { key: 'd6c', label: '班组成员工作许可制度执行不到位——网省公司层面一般违章', ...fill(-5, '次') },
          { key: 'd6d', label: '班组成员工作许可制度执行不到位——严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd7a', label: '抢修作业现场安全管理不到位——中心层面一般违章', ...fill(-1, '次') },
          { key: 'd7b', label: '抢修作业现场安全管理不到位——市公司层面一般违章', ...fill(-3, '次') },
          { key: 'd7c', label: '抢修作业现场安全管理不到位——网省公司层面一般违章', ...fill(-5, '次') },
          { key: 'd7d', label: '抢修作业现场安全管理不到位——严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd8', label: '因班组日常监督管理工作不到位，造成在上级公司或外部监管检查中发现有人员直接责任的违规事项', ...fill(-10, '件') },
          { key: 'd9', label: '未按要求开展班组及代维单位安全学习、警示教育、设备台账梳理等工作', ...fill(-5, '次') },
          { key: 'd10', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  distributionEngineeringTeamLeader: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按中心要求开展 10（20）千伏及以下配网成资本项目、业扩配套等工程项目的现场实施、安全、质量、进度管控、验收、送电及资料归档、结决算报审及转资等工作；同步做好工程物资领用、退库、废旧物资回收处置，以及施工现场文明施工、环境管控等工作；参与配网项目前期勘查，配合开展不停电作业施工等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '月度 95598 工单回访满意率高于 98%', options: has(5) },
          { key: 'q2', label: '班组配网工程建设获上级公司肯定或客户表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q3', label: '提出优化工程实施方案、压降库存物资，以及提升转资综合质量达标率等工作的合理化建议被采纳实施并产生实效', ...fill(5, '项') },
          { key: 'q4', label: '牵头完成中心布置的急难险重专项任务', ...fill(5, '项') },
          { key: 'q5', label: '班组成员在工程建设工作中获得中心层面季度、年度表彰', ...fill(3, '人次') },
          { key: 'q6a', label: '推动网架项目建设、配电设施新建与改造、重要用户双电源改造等工作在苏电融媒体矩阵宣传', ...fill(3, '项') },
          { key: 'q6b', label: '在系统外主流媒体宣传', ...fill(5, '项') },
          { key: 'q6c', label: '在三大央媒宣传', ...fill(10, '项') },
          { key: 'q7', label: '班组承担的工程投资完成率、工程结决算报审超期、工程转资综合质量达标率、物资库存压降率等专业考核指标在主城区四个中心排名', options: rankLead3_0() },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '班组因人员履职不到位造成施工扰民、停电、阻碍交通通行等引发意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '班组因人员履职不到位造成施工扰民、停电、阻碍交通通行等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '月度 95598 工单回访满意率低于 98%', options: has(-2) },
          { key: 'd3', label: '班组承担的专业考核指标在主城区四个中心连续两个月排名末位', ...fill(-5, '项') },
          { key: 'd4a', label: '工程施工现场违章——中心层面一般违章', ...fill(-1, '次') },
          { key: 'd4b', label: '工程施工现场违章——市公司层面一般违章', ...fill(-3, '次') },
          { key: 'd4c', label: '工程施工现场违章——网省公司层面一般违章', ...fill(-5, '次') },
          { key: 'd4d', label: '工程施工现场违章——严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd5', label: '因班组日常监督管理工作不到位，造成在上级公司或外部监管检查中发现有人员直接责任的违规事项', ...fill(-10, '件') },
          { key: 'd6', label: '未按要求开展班组安全学习、警示教育、竣工资料归档等工作', ...fill(-5, '次') },
          { key: 'd7', label: '未按时完成中心领导交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  // ============== 三、班组成员岗位（5 个） ==============
  businessTeamMember: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按班组职责要求开展营业厅窗口业务办理、电费收缴、客户档案管理、业扩受理、客户服务及工单处置等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '落实优质服务要求，做好特殊群体便民服务', ...fill(3, '项') },
          { key: 'q2', label: '承担班组报表统计、学习台账记录等综合管理工作', ...fill(3, '项') },
          { key: 'q3', label: '承担班组营业风险防控、客户信息维护等专项任务', ...fill(3, '项') },
          { key: 'q4', label: '主动参加党员志愿服务、社会公益活动', ...fill(3, '次') },
          { key: 'q5', label: '客户服务获表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q6', label: '在客户服务工作中获得中心层面季度、年度表彰', ...fill(3, '次') },
          { key: 'q7', label: '个人撰写的班组亮点工作、服务案例在上级公司予以宣传', ...fill(5, '项') },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '因个人履职不当、服务不规范、态度恶劣等引发优质服务意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '因个人履职不当、服务不规范、态度恶劣等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '未按要求参加班组服务规范性、资金安全规范性、网络安全等学习，以及业务培训等工作', ...fill(-5, '次') },
          { key: 'd3', label: '未按时完成班组长交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  keyAccountTeamMember: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按班组职责要求承担服务辖区 10 千伏及以上高压客户全流程业扩报装、用电检查、电费回收、重要保电、能效服务、客户关系维护、停电协调等工作，以及开展客户用电咨询、电价政策、电力市场化交易、绿电等业务宣贯，协助客户办理相关业务等本职工作，落实"一口对外"服务模式',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '落实优化营商环境工作要求，主动对接客户按时做好省市重大项目送电', ...fill(3, '项') },
          { key: 'q2', label: '在重大保供电任务中连续值守表现突出', ...fill(3, '项') },
          { key: 'q3', label: '在协调处理电费争议、计量异议、停电协调等各类用电纠纷中主动担当表现突出', ...fill(5, '项') },
          { key: 'q4', label: '负责的电力客户月度电费回收率达 100%', ...fill(5, '项') },
          { key: 'q5', label: '承担班组客户台账、资料与信息化管理、学习培训、班组建设等综合管理工作', ...fill(3, '项') },
          { key: 'q6', label: '承担班组电力市场拓展、需求侧与负荷管理、重要客户重大活动客户侧保电措施等专项任务', ...fill(3, '项') },
          { key: 'q7', label: '主动参加党员志愿服务、社会公益活动', ...fill(3, '次') },
          { key: 'q8', label: '客户服务获表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q9', label: '在客户服务工作中获得中心层面季度、年度表彰', ...fill(3, '次') },
          { key: 'q10', label: '个人撰写的班组亮点工作、服务案例在上级公司予以宣传', ...fill(5, '项') },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '因个人履职不当、服务不规范、态度恶劣等引发优质服务意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '因个人履职不当、服务不规范、态度恶劣等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '因个人履职不到位，造成在上级公司或外部监管检查中发现有人员直接责任的违规事项（业扩报装超期、临时用电超期、定比定量核定超期、暂停减容超期、用电检查超期、电价执行错误等）', ...fill(-10, '项') },
          { key: 'd3', label: '未按要求参加班组安全管理、业扩规范、政策法规、业务培训、"三指定"警示教育等学习任务', ...fill(-5, '次') },
          { key: 'd4', label: '未按时完成班组长交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  lvIntegratedTeamMember: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按班组职责要求承担服务辖区低压客户业扩报装、计量及采集运维、电费相关现场业务、用电检查与反窃电，以及表计、计量表箱改造、低压业扩配套等项目安全管理与现场作业管控；落实网格服务要求，压降工单数量，常态化开展用电咨询、用电安全宣传、电力政策宣传等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '落实网格经理职责，对接辖区社区、物业、客户，主动收集客户用电诉求、矛盾问题，就地协调化解', ...fill(3, '项') },
          { key: 'q2', label: '在为民办实事、解决群众急难愁盼用电难题等工作中表现突出', ...fill(3, '项') },
          { key: 'q3', label: '在协调处理电费争议、计量异议、停电协调等各类用电纠纷中，主动担当做好客户沟通解释与舆情防控工作', ...fill(5, '项') },
          { key: 'q4', label: '负责的电力客户月度电费回收率达 100%', ...fill(5, '项') },
          { key: 'q5', label: '承担班组客户台账、资料与信息化管理、学习培训、班组建设等综合管理工作', ...fill(3, '项') },
          { key: 'q6', label: '承担班组表计轮换、台区线损管控、低压供电可靠性提升等专项任务', ...fill(3, '项') },
          { key: 'q7', label: '主动参加党员志愿服务、社会公益活动', ...fill(3, '次') },
          { key: 'q8', label: '客户服务获表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q9', label: '在客户服务工作中获得中心层面季度、年度表彰', ...fill(3, '次') },
          { key: 'q10', label: '个人撰写的班组亮点工作、服务案例在上级公司予以宣传', ...fill(5, '项') },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '因个人履职不当、服务不规范、态度恶劣等引发优质服务意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '因个人履职不当、服务不规范、态度恶劣等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2a', label: '作业现场违章——中心层面一般违章', ...fill(-1, '次') },
          { key: 'd2b', label: '作业现场违章——市公司层面一般违章', ...fill(-3, '次') },
          { key: 'd2c', label: '作业现场违章——网省公司层面一般违章', ...fill(-5, '次') },
          { key: 'd2d', label: '作业现场违章——严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd3', label: '因个人履职不到位，造成在上级公司或外部监管检查中发现有人员直接责任的违规事项（业扩报装超期、临时用电超期、电价执行错误、一址多户、高低压混供等）', ...fill(-10, '项') },
          { key: 'd4', label: '未按要求参加班组安全管理、业扩规范、政策法规、业务培训、警示教育等学习任务', ...fill(-5, '次') },
          { key: 'd5', label: '未按时完成班组长交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  distributionOperationTeamMember: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按班组职责要求承担辖区配电设施运行巡视、缺陷闭环、设备检修、维护与试验、故障抢修与工单处置、工程验收与生产准备、停、送电许可、电力设施保护等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '在重大保供电任务中表现突出', ...fill(3, '项') },
          { key: 'q2', label: '在迎峰度夏（冬）、防汛防台等关键时期连续值守', ...fill(3, '项') },
          { key: 'q3', label: '在故障抢修、抢险救灾等工作中主动请缨、冲锋在前', ...fill(3, '项') },
          { key: 'q4', label: '主动承担班组急难险重专项攻坚任务', ...fill(3, '项') },
          { key: 'q5', label: '月度持票许可工作在本班组数量最多且无差错的', options: has(5) },
          { key: 'q6', label: '承担班组设备台账、资料与信息化管理、学习培训、班组建设、安全工器具管理等综合管理工作', ...fill(3, '项') },
          { key: 'q7', label: '主动参加党员志愿服务、社会公益活动', ...fill(3, '次') },
          { key: 'q8', label: '保供电、消安全隐患等工作获表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q9', label: '在精益运维、工单处置等工作中获得中心层面季度、年度表彰', ...fill(3, '次') },
          { key: 'q10', label: '个人撰写的班组亮点工作、强保供案例在上级公司予以宣传', ...fill(5, '项') },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '个人负责的运维片区因隐患治理不到位、缺陷消缺未闭环造成频繁停电，或现场抢修拖沓等引发意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '个人负责的运维片区因隐患治理不到位、缺陷消缺未闭环造成频繁停电，或现场抢修拖沓等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '在工程中间验收、竣工交接验收环节履职不到位，未及时提出整改意见造成带缺陷移交运行的', ...fill(-5, '项') },
          { key: 'd3a', label: '抢修作业现场违章——中心层面一般违章', ...fill(-1, '次') },
          { key: 'd3b', label: '抢修作业现场违章——市公司层面一般违章', ...fill(-3, '次') },
          { key: 'd3c', label: '抢修作业现场违章——网省公司层面一般违章', ...fill(-5, '次') },
          { key: 'd3d', label: '抢修作业现场违章——严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd4a', label: '工作许可制度执行不到位——中心层面一般违章', ...fill(-1, '次') },
          { key: 'd4b', label: '工作许可制度执行不到位——市公司层面一般违章', ...fill(-3, '次') },
          { key: 'd4c', label: '工作许可制度执行不到位——网省公司层面一般违章', ...fill(-5, '次') },
          { key: 'd4d', label: '工作许可制度执行不到位——严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd5', label: '未按要求参加班组安全管理、技能培训、警示教育等学习任务', ...fill(-5, '次') },
          { key: 'd6', label: '未按时完成班组长交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },

  distributionEngineeringTeamMember: {

    sections: [
      {
        title: '基础履职',
        items: [{
          key: 'baseDuty',
          label: '按班组职责要求承担 10（20）千伏及以下配网项目的现场实施、安全、质量、进度管控、验收、送电及资料归档、工程物资领用、退库、废旧物资回收处置，以及施工现场文明施工、环境管控等工作；参与配网项目前期勘查，配合开展不停电作业施工等本职工作',
          options: y(20),
        }],
      },
      {
        title: '提质赋分',
        items: [
          { key: 'q1', label: '在网架项目建设中攻坚克难表现突出', ...fill(3, '项') },
          { key: 'q2', label: '负责的配网项目获评上级公司优质工程', ...fill(5, '项') },
          { key: 'q3', label: '负责的配网工程建设获上级公司肯定或客户表扬工单，或送锦旗、感谢信等', ...fill(3, '次') },
          { key: 'q4', label: '在工程建设、优质服务工作中获得中心层面季度、年度表彰', ...fill(3, '次') },
          { key: 'q5', label: '承担班组工程资料与台账管理、学习培训、班组建设等综合管理工作', ...fill(3, '项') },
          { key: 'q6', label: '主动参加党员志愿服务、社会公益活动', ...fill(3, '次') },
          { key: 'q7', label: '个人撰写的班组亮点工作、攻坚克难案例在上级公司予以宣传', ...fill(5, '项') },
        ],
      },
      {
        title: '履职扣分',
        items: [
          { key: 'd1a', label: '施工现场因个人履职不到位造成扰民、停电、阻碍交通通行等引发意见工单', ...fill(-5, '张') },
          { key: 'd1b', label: '施工现场因个人履职不到位造成扰民、停电、阻碍交通通行等引发有责投诉工单', ...fill(-10, '张') },
          { key: 'd2', label: '负责的项目未规范组织工程中间验收、竣工交接验收，或未及时落实配电运检班提出的整改意见造成投运滞后的', ...fill(-5, '项') },
          { key: 'd3a', label: '施工现场违章——中心层面一般违章', ...fill(-1, '次') },
          { key: 'd3b', label: '施工现场违章——市公司层面一般违章', ...fill(-3, '次') },
          { key: 'd3c', label: '施工现场违章——网省公司层面一般违章', ...fill(-5, '次') },
          { key: 'd3d', label: '施工现场违章——严重违章（年度红线）', ...fill(-20, '次') },
          { key: 'd4', label: '因个人履职不到位，造成在上级公司或外部监管检查中发现有人员直接责任的违规事项（工程签证不实、物资应退未退或未足量退库、拆旧物资未回收等）', ...fill(-10, '项') },
          { key: 'd5', label: '未按要求参加班组安全管理、业务培训、警示教育等学习任务', ...fill(-5, '次') },
          { key: 'd6', label: '未按时完成班组长交办的工作任务', ...fill(-5, '次') },
        ],
      },
    ],
  },
};

// =================================================================
// 个人表单覆盖（per work_id 级别）—— ⚠️ 现在只是「代码兜底」，一般不用改这里
// -----------------------------------------------------------------
// ★ 首选做法：用系统管理员登录 → 进 /backdoor →「个人问卷维护」Tab，
//   在线给某个员工定制整份问卷并保存 —— 数据落在数据库 form_override 表，
//   保存即生效，不需要改代码、不需要重新打包部署。（仅系统管理员可操作）
//
// ★ 下面的 USER_FORM_OVERRIDES 是**代码级**覆盖，优先级低于数据库那份，
//   只在「库里没给这个人定制过」时才参与合并（见 constants.resolveFormDef）。
//   留在代码里的用途：
//     - 成批的、有规律的调整（比如某岗位全员都减同一道题），写成配置比逐人录入省事
//     - 需要跟着代码一起 review / 回滚的调整
//
// 完整生效优先级（从高到低）：
//   ① 已审核记录的历史快照 evaluation.scores.snapshot（永不改）
//   ② 数据库 form_override（/backdoor →「个人问卷维护」）
//   ③ 本文件的 USER_FORM_OVERRIDES（代码兜底，即下面这段）
//   ④ 14 套岗位基础模板 POSITION_FORMS
// -----------------------------------------------------------------
// 用途：让个别员工在 14 套岗位模板的基础上"个性化"题目。
// 适用场景：同岗位大多数人共用一套模板，但有少数员工因岗位职责差异，
//         需要增/删/改模板里的某些题。
// 五种能力（互不影响、可同时使用）：
//   1) 减项 removeItemKeys: ['q1', 'q3']
//                            按 key 从基础模板里删题
//   2) 改项 updateItems:    [{ key: 'q4', fields: { label: '...', unitScore: 12 } }]
//                            按 key 浅合并覆盖字段（label / unitScore / unit / hasReason / options...）
//   3) 加项 addItems:       [{ sectionTitle, key, label, ... }]
//                            默认追加到指定段尾；加 beforeKey / afterKey 可插到某题前/后
//   4) 题序 orderItems:     ['q2', 'custom1', 'q4']
//                            全局优先级列表：列出的 key 按数组顺序排在前面，
//                            未列出的跟在后面、保持原相对顺序。因为是"段内排序"，
//                            一个数组里混写多段的 key 也各归各段，互不干扰
//   5) 段序 orderSections:  ['提质赋分', '基础履职', '履职扣分']
//                            同一套语义，作用于章节之间的排列顺序
// 行为约束：
//   - 加项 / 改项 / 调序只对「之后提交」的记录生效；已存的快照（snapshot）机制
//     保证历史记录永远按当时定义与当时顺序渲染，不会因后改配置而错位
//   - 换岗 / 离职：从本表中删除该 work_id 即可
//   - position 必须与 user_table.job 一致，岗位不匹配时整条配置自动失效
//   - 整章被减光时该章节一起隐掉（applyUserFormOverrides 自动过滤 items=[] 的段）
//   - addItems 的 key 若与现有题重复 → 原地覆盖该题（保持原位置）；
//     updateItems / removeItemKeys / orderItems 与 addItems 不会互相打架
// 维护人：开发者（手改本文件 + 重新打包部署）
//   —— ⚠️ 单人定制请优先用 /backdoor 的「个人问卷维护」；这里适合成批调整。
// 重要约束：减项 / 改项 / 调序规则必须在他开始自评之前定好，否则 evaluation 表
//   里已经存的老分数会和「题目页少了几道题/改了题/换了顺序」对不上。
// 结构：{ 'work_id': { position, removeItemKeys?, updateItems?,
//                      addItems?, orderItems?, orderSections? } }
// -----------------------------------------------------------------
// 可用的题目构造工具（本文件已导出，下面的配置可直接用）：
//   fill(unitScore, unit)      填空题：{ type:'fill', unitScore, unit, hasReason:true }
//   y(score) / has(score)      两选项选择题：[满足/不满足] / [有/无]
//   rankPro4() / rankLead3() / rankLead3_0()
//                              排名选择题（4 名 / 3 名 / 3 名首位 0 分）
//   patchOptions(options, { value: { score, label } })
//                              只改选项分值/文案，不必整段重写 options
// 调用方式（已封装在 getPositionForm(position, workId) 里，调用方一般不用手写）：
//   import { POSITION_FORMS, applyUserFormOverrides, USER_FORM_OVERRIDES } from './forms-data.mjs';
//   const final = applyUserFormOverrides(POSITION_FORMS.distributionTech, USER_FORM_OVERRIDES['W-0007']);
// =================================================================

// ★ 已启用：下面第一条是「示例条目」，key 用的是非真实工号，
//   所以它只演示用法、不会对任何人生效。
//   注意：若某员工已在「个人问卷维护」里存过问卷，则会以库里那份为准，
//        本表里针对他的条目不会再生效（优先级见上方完整列表）。
//   要对某个真实员工生效 → 把 'EXAMPLE-WORK-ID' 换成他的 work_id（如 'W-0007'），
//   并把 position 改成他注册时选的岗位即可。不再需要的人 → 整条删掉。
export const USER_FORM_OVERRIDES = {
  'EXAMPLE-WORK-ID': {
    position: 'distributionTech', // 必须与 user_table.job 一致，不一致整条配置自动失效

    // ① 减题：按 key 从任意段删掉（整段删光 → 该章节一起隐掉）
    removeItemKeys: ['q1', 'q3'],

    // ② 改题：按 key 浅合并覆盖字段（可只改 label，也可只改 unitScore）
    updateItems: [
      // 2a. 改填空题：换题干 + 换单次分值
      {
        key: 'q2',
        fields: {
          label: '牵头完成中心布置的急难险重专项任务（本岗位专有口径）',
          unitScore: 8,
        },
      },
      // 2b. 改选择题：只把「排名第一」由 10 分调成 15 分，其余选项不动
      {
        key: 'q4',
        fields: { options: patchOptions(rankPro4(), { r1: { score: 15 } }) },
      },
    ],

    // ③ 加题：sectionTitle 指定归属段（该段不存在 → 新建一段追加到末尾）
    addItems: [
      // 3a. 加填空题
      {
        sectionTitle: '提质赋分',
        key: 'custom_fill_1', // 不可与现有题 key 重复（重复则覆盖现有题）
        label: '完成中心领导交办的临时专项任务',
        ...fill(3, '项'),
      },
      // 3b. 加选择题（渲染成单选 Radio，选项分值写进 options[].score）
      {
        sectionTitle: '提质赋分',
        key: 'custom_choice_1',
        label: '本月是否参加中心层面的技术比武并获奖',
        options: [
          { value: 'yes', label: '有', score: 5 },
          { value: 'no', label: '无', score: 0 },
        ],
      },
      // 3c. 加选择题（复用 y() / has() / rankPro4() 等选项构造器）
      {
        sectionTitle: '基础履职',
        key: 'custom_choice_2',
        label: '本月是否按中心要求完成全部台账归档',
        options: y(20), // → [满足 +20 分 / 不满足 0 分]
      },
      // 3d. 指定插入位置：插到 q4 前面
      //     （不写 beforeKey / afterKey → 默认追加到目标段尾）
      //     用 beforeKey/afterKey 时，目标段以「锚点题所在段」为准，sectionTitle 可省
      {
        sectionTitle: '提质赋分',
        key: 'custom_fill_2',
        label: '牵头完成上级临时布置的数据治理专项',
        ...fill(4, '项'),
        beforeKey: 'q4',
      },
    ],

    // ④ 题序：列出的 key 按此顺序排在前面，未列出的跟在后面（保持原相对顺序）
    //    —— 想调整现成题的先后，只写这一行即可，完全不用动上面的 POSITION_FORMS
    orderItems: ['q2', 'custom_fill_1', 'custom_fill_2', 'custom_choice_1'],

    // ⑤ 段序：章节之间的排列顺序（同一套语义：列出的在前，未列出的在后）
    //    —— 这里把「基础履职」挪到最后
    orderSections: ['提质赋分', '履职扣分', '基础履职'],
  },
};

// 构造"提交时刻"的题目快照
// ---------------------------------------------------------------
// 用途：员工提交自评 / 审核人提交审核时，把当时的题目定义 + 用户作答
//      一起 JSON 化存到 evaluation.scores.snapshot（或 reviewScores.snapshot）。
// 设计目的：审计回放 —— 以后改 forms-data.mjs 不会污染历史记录。
//   - 选择题：存 options 全集 + selected value + 当时选项的 score
//   - 填空题：存 unit / unitScore / count / reason + 当时算出来的 score
// 兼容：
//   - 填空题新形状 {count, reason}  → 正常取数
//   - 填空题老形状（直接一个数字） → 视为 count，reason=''
//   - 选择题未选                  → selected=null, score=0
//   - 题目定义里没有的 key         → 不进 snapshot（不污染）
export const buildPositionFormSnapshot = (formDef, answers = {}) => {
  const snap = {};
  if (!formDef?.sections) return snap;
  formDef.sections.forEach((sec) =>
    sec.items.forEach((it) => {
      if (it.type === 'fill') {
        const raw = answers[it.key];
        const count =
          raw === undefined || raw === null
            ? 0
            : Number(typeof raw === 'object' ? raw.count : raw) || 0;
        const reason =
          raw && typeof raw === 'object' ? (raw.reason ?? '') : '';
        const score = count * (it.unitScore || 0);
        snap[it.key] = {
          type: 'fill',
          sectionTitle: sec.title,
          label: it.label,
          unit: it.unit,
          unitScore: it.unitScore,
          hasReason: it.hasReason !== false, // 缺省 true：是否渲染"请说明原因"文本框
          count,
          reason,
          score,
        };
      } else {
        // choice / radio
        const selected = answers[it.key];
        const opt = it.options?.find((o) => o.value === selected);
        snap[it.key] = {
          type: 'choice',
          sectionTitle: sec.title,
          label: it.label,
          options: it.options?.map((o) => ({
            value: o.value,
            label: o.label,
            score: o.score,
          })),
          selected: selected ?? null,
          selectedLabel: opt?.label ?? null,
          score: opt?.score ?? 0,
        };
      }
    }),
  );
  return snap;
};

// 把落库的 snapshot 还原成 formDef 形状（{ sections: [{ title, items }] }）
// ---------------------------------------------------------------
// 用途：只读回显历史表单时，**按库里的题干渲染**，而不是按当前 forms-data.mjs。
//       这样即便以后改了题目（改文字 / 加题 / 删题 / 改分值），
//       老记录仍能原样显示"当时用户看到的题目与他的作答"。
// 入参：evaluation.scores.snapshot 或 reviewScores.snapshot（或 rating.snapshot 不适用）
// 返回：null（无 snapshot / 空）→ 调用方回落现场表单
// 说明：
//   - 按 snapshot 里 sectionTitle 首次出现的顺序分组，保持题序稳定
//   - 填空题还原 unit / unitScore / hasReason；选择题还原 options
//   - snapshot 没存 sectionTitle（老数据）→ 归到「（历史表单）」一段，仍能显示
export const formDefFromSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const order = [];
  const bySection = new Map();
  for (const [key, s] of Object.entries(snapshot)) {
    if (!s || typeof s !== 'object') continue;
    const title = s.sectionTitle || '（历史表单）';
    if (!bySection.has(title)) {
      bySection.set(title, []);
      order.push(title);
    }
    const item =
      s.type === 'fill'
        ? {
            key,
            type: 'fill',
            label: s.label,
            unit: s.unit,
            unitScore: s.unitScore,
            hasReason: s.hasReason !== false,
          }
        : {
            key,
            label: s.label,
            options: (s.options || []).map((o) => ({
              value: o.value,
              label: o.label,
              score: o.score,
            })),
          };
    bySection.get(title).push(item);
  }
  if (!bySection.size) return null;
  return { sections: order.map((t) => ({ title: t, items: bySection.get(t) })) };
};

// 把 per-work_id 的覆盖规则合并到基础表单上
// ---------------------------------------------------------------
// 入参：
//   baseForm  - POSITION_FORMS[position] 的原始定义
//   overrides - USER_FORM_OVERRIDES[work_id] 的配置：
//     {
//       position,                 // 必须与岗位一致，否则整条失效
//       removeItemKeys?: [key],   // ① 减题
//       updateItems?:    [{ key, fields }],                    // ② 改题（浅合并）
//       addItems?:       [{ sectionTitle, key, ...,
//                           beforeKey?, afterKey? }],          // ③ 加题（可指定插入位置）
//       orderItems?:     [key],   // ④ 题序（全局优先级列表，段内生效）
//       orderSections?:  [title], // ⑤ 段序（章节排列顺序）
//     }
// 返回：合并后的 formDef（浅拷贝，不会污染 POSITION_FORMS 原值）
// 处理顺序（很重要）：
//   1) 减项（按 key 从所有段删题）
//   2) 改项（按 key 浅合并覆盖字段；label / unitScore / unit / hasReason / options...）
//   3) 加项（默认追加到目标段尾；可用 beforeKey / afterKey 插到指定题前/后）
//      - 目标段判定：优先 beforeKey/afterKey 所在的那一段 → 其次 sectionTitle → 都没有则新建段
//      - 若新题 key 与现有题重复：原地覆盖该题（保持原位置）
//   4) 题序 orderItems：列出的 key 按数组顺序排在前面，未列出的跟在后面保持原相对顺序
//      - 因为是"段内排序"，所以一个数组里混写多段的 key 也各归各段，互不干扰
//   5) 过滤掉 items=[] 的空段（整章被减光时该章节一起隐掉）
//   6) 段序 orderSections：同 orderItems 语义，作用于章节
// 兼容性：
//   - overrides 可省略任意字段（旧 schema 只有 position + removeItemKeys 也能用）
//   - 任意中间步骤失败都会原样返回 baseForm 兜底（fail-safe）
export const applyUserFormOverrides = (baseForm, overrides) => {
  if (!baseForm?.sections || !overrides) return baseForm;
  try {
    const removeSet = new Set(overrides.removeItemKeys || []);
    const updateMap = new Map(
      (overrides.updateItems || []).map((u) => [u.key, u.fields || {}])
    );

    // 1+2) 浅拷贝 sections + items，逐项减/改
    const sections = baseForm.sections.map((sec) => ({
      ...sec,
      items: sec.items
        .filter((it) => !removeSet.has(it.key))
        .map((it) =>
          updateMap.has(it.key) ? { ...it, ...updateMap.get(it.key) } : it
        ),
    }));

    // 3) 加项（支持 beforeKey / afterKey 指定插入位置）
    for (const add of overrides.addItems || []) {
      if (!add || !add.key) continue;
      const { sectionTitle, beforeKey, afterKey, ...item } = add;

      // 冲突：原地替换（覆盖语义）
      const hitSec = sections.find((s) =>
        s.items.some((x) => x.key === item.key)
      );
      if (hitSec) {
        const at = hitSec.items.findIndex((x) => x.key === item.key);
        hitSec.items[at] = item;
        continue;
      }

      // 定位目标段：锚点题所在段 > sectionTitle 指定段 > 新建段
      const anchor = beforeKey || afterKey;
      const anchorSec = anchor
        ? sections.find((s) => s.items.some((x) => x.key === anchor))
        : null;
      let target = anchorSec || sections.find((s) => s.title === sectionTitle);
      if (!target) {
        target = { title: sectionTitle || '（自定义）', items: [] };
        sections.push(target);
      }

      // 定位插入下标：默认段尾；beforeKey 插到其前，afterKey 插到其后
      let idx = target.items.length;
      if (beforeKey) {
        const i = target.items.findIndex((x) => x.key === beforeKey);
        if (i >= 0) idx = i;
      } else if (afterKey) {
        const i = target.items.findIndex((x) => x.key === afterKey);
        if (i >= 0) idx = i + 1;
      }
      target.items.splice(idx, 0, item);
    }

    // 4) 题序：全局优先级列表 → 段内排序（未列出的按原相对顺序排在其后）
    if (Array.isArray(overrides.orderItems) && overrides.orderItems.length) {
      const rank = new Map(overrides.orderItems.map((k, i) => [k, i]));
      const base = overrides.orderItems.length;
      sections.forEach((sec) => {
        sec.items = sec.items
          .map((it, i) => ({
            it,
            r: rank.has(it.key) ? rank.get(it.key) : base + i,
          }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.it);
      });
    }

    // 5) 过滤空段
    let out = sections.filter((s) => s.items.length > 0);

    // 6) 段序：同 orderItems 语义，作用于章节
    if (Array.isArray(overrides.orderSections) && overrides.orderSections.length) {
      const rank = new Map(overrides.orderSections.map((t, i) => [t, i]));
      const base = overrides.orderSections.length;
      out = out
        .map((s, i) => ({ s, r: rank.has(s.title) ? rank.get(s.title) : base + i }))
        .sort((a, b) => a.r - b.r)
        .map((x) => x.s);
    }

    return { ...baseForm, sections: out };
  } catch (e) {
    console.error('[applyUserFormOverrides] 合并失败，原样返回基础定义：', e);
    return baseForm;
  }
};
