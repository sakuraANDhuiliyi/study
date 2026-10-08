CREATE TABLE "AcademicsSubject" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL CHECK (char_length("name") BETWEEN 1 AND 100),
  "description" TEXT NOT NULL DEFAULT '' CHECK (char_length("description") <= 4000),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AcademicsSubject_organizationId_active_idx" ON "AcademicsSubject"("organizationId","active");
CREATE UNIQUE INDEX "AcademicsSubject_org_name_key" ON "AcademicsSubject"(COALESCE("organizationId",''),"name");
CREATE TABLE "AcademicsMajor" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "subjectId" TEXT NOT NULL REFERENCES "AcademicsSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL CHECK (char_length("name") BETWEEN 1 AND 100),
  "description" TEXT NOT NULL DEFAULT '' CHECK (char_length("description") <= 4000),
  "moduleIds" TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality("moduleIds") <= 60),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AcademicsMajor_organizationId_active_idx" ON "AcademicsMajor"("organizationId","active");
CREATE INDEX "AcademicsMajor_subjectId_idx" ON "AcademicsMajor"("subjectId");
CREATE UNIQUE INDEX "AcademicsMajor_org_name_key" ON "AcademicsMajor"(COALESCE("organizationId",''),"name");
ALTER TABLE "User" ADD CONSTRAINT "User_majorId_fkey" FOREIGN KEY ("majorId") REFERENCES "AcademicsMajor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_personalMajorId_fkey" FOREIGN KEY ("personalMajorId") REFERENCES "AcademicsMajor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "AcademicsPreference" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "selectedModuleIds" TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality("selectedModuleIds") <= 60),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "AcademicsPreference_organizationId_userId_key" ON "AcademicsPreference"("organizationId","userId");
CREATE INDEX "AcademicsPreference_userId_idx" ON "AcademicsPreference"("userId");
CREATE TABLE "AcademicsRecord" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "moduleId" TEXT NOT NULL,
  "title" TEXT NOT NULL CHECK (char_length("title") BETWEEN 1 AND 160),
  "values" JSONB NOT NULL CHECK (octet_length("values"::text) <= 98304),
  "result" JSONB NOT NULL CHECK (octet_length("result"::text) <= 98304),
  "notes" TEXT NOT NULL DEFAULT '' CHECK (char_length("notes") <= 12000 AND octet_length("notes") <= 36000),
  "status" TEXT NOT NULL DEFAULT 'COMPLETED' CHECK ("status" IN ('DRAFT','COMPLETED')),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AcademicsRecord_organizationId_userId_moduleId_createdAt_id_idx" ON "AcademicsRecord"("organizationId","userId","moduleId","createdAt","id");
CREATE INDEX "AcademicsRecord_userId_idx" ON "AcademicsRecord"("userId");

-- Versioned original starting templates; institutions may add their own scoped definitions.
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-philosophy','哲学','论证、逻辑、伦理与批判思维。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-economics','经济学','经济模型、金融数学与市场分析。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-law','法学与社会治理','法律论证、社会研究、公共议题与证据分析。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-education','教育学','教学设计、教育研究与运动表现分析。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-literature','文学与语言','阅读、写作、外语、翻译与新闻传播。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-history','历史学','史料整理、年代脉络、来源比较与历史论证。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-science','理学','数学、物理、化学、生物与地理的模型和实验。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-engineering','工学','计算机、电子、机械、土木、建筑与环境工程。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-agriculture','农学','农业水量、遗传、食品与生态系统学习。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-medicine','医学与健康科学','解剖、生理、单位换算与模拟观察记录的课程练习。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-military','军事学与国防教育','国防教育中的历史研究、地理测量与后勤管理基础。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-management','管理学','会计、项目、供应链、营销与服务管理。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-art','艺术学','设计、音乐、作品集与视觉表达。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-interdisciplinary','交叉学科','数据科学、认知研究、数字人文与跨专业项目。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsSubject" ("id","name","description","updatedAt") VALUES ('subject-general','通识与自主学习','自由笔记、研究计划与可自主组合的学习工具。',CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-computer-science','subject-engineering','计算机科学与技术','从算法与数据库到网络与软件设计，练习可运行的实现与工程思考。',ARRAY['algorithms','sql-lab','subnet-lab','software-design','data-science','cybersecurity-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-software-engineering','subject-engineering','软件工程','结合需求、数据模型、测试与迭代计划完成软件项目。',ARRAY['algorithms','sql-lab','software-design','project-planning','design-contrast','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-artificial-intelligence','subject-engineering','人工智能','从矩阵、概率与数据分析理解建模过程和评估。',ARRAY['matrix-lab','probability-lab','statistics-lab','data-science','algorithms','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-data-science','subject-interdisciplinary','数据科学与大数据技术','练习数据查询、预处理、描述统计和回归分析。',ARRAY['sql-lab','data-science','statistics-lab','matrix-lab','probability-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-cybersecurity','subject-engineering','网络空间安全','理解子网、基础密码变换和软件安全需求，练习防御性思考。',ARRAY['subnet-lab','cybersecurity-lab','algorithms','software-design','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-network-engineering','subject-engineering','网络工程','用CIDR、网络地址和连通性工具学习网络规划。',ARRAY['subnet-lab','algorithms','project-planning','digital-logic','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-information-systems','subject-management','信息管理与信息系统','将数据库查询、业务指标与需求设计结合起来。',ARRAY['sql-lab','software-design','business-analysis','project-planning','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-electrical-engineering','subject-engineering','电气工程及其自动化','分析电阻网络、功率、逻辑电路与动力学。',ARRAY['circuit-lab','digital-logic','physics-motion','matrix-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-electronic-information','subject-engineering','电子信息工程','练习电路、逻辑、信号所需的数学与网络基础。',ARRAY['circuit-lab','digital-logic','calculus-lab','subnet-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-telecommunications','subject-engineering','通信工程','组合网络地址、概率、数据和电路分析工具。',ARRAY['subnet-lab','probability-lab','circuit-lab','matrix-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-automation','subject-engineering','自动化','从动力学、线性代数和电路模型建立系统分析习惯。',ARRAY['physics-motion','matrix-lab','circuit-lab','data-science','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-robotics','subject-engineering','机器人工程','把机构运动、矩阵运算、逻辑和项目设计结合起来。',ARRAY['mechanics-lab','matrix-lab','digital-logic','software-design','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-mechanical-engineering','subject-engineering','机械工程','学习齿轮传动、简支梁与物理运动的理想模型。',ARRAY['mechanics-lab','civil-beam','physics-motion','scale-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-aerospace','subject-engineering','航空航天工程','用运动、结构、数值积分与项目管理练习工程建模。',ARRAY['physics-motion','civil-beam','calculus-lab','project-planning','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-civil-engineering','subject-engineering','土木工程','练习结构静力、尺度与项目进度的基础计算。',ARRAY['civil-beam','scale-lab','project-planning','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-architecture','subject-engineering','建筑学','从空间任务书、尺度换算与视觉表达组织设计过程。',ARRAY['architecture-studio','scale-lab','design-contrast','design-portfolio','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-urban-planning','subject-engineering','城乡规划','以空间测量、调查、设计任务书与项目计划分析规划议题。',ARRAY['geography-lab','social-research','architecture-studio','project-planning','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-environmental-engineering','subject-engineering','环境工程','练习混合水体质量守恒、农业水量和环境数据分析。',ARRAY['environment-lab','chemistry-solution','statistics-lab','geography-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-chemical-engineering','subject-engineering','化学工程与工艺','结合反应配平、溶液计算与质量平衡。',ARRAY['chemistry-balance','chemistry-solution','environment-lab','calculus-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-materials','subject-engineering','材料科学与工程','使用化学、力学和统计工具整理材料实验。',ARRAY['chemistry-balance','chemistry-solution','civil-beam','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-biomedical-engineering','subject-interdisciplinary','生物医学工程','联系生物结构、信号数学与工程测量。',ARRAY['anatomy-quiz','circuit-lab','data-science','genetics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-mathematics','subject-science','数学与应用数学','练习矩阵、微积分、概率和数学论证。',ARRAY['matrix-lab','calculus-lab','probability-lab','algorithms','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-statistics','subject-science','统计学','理解样本、描述统计、线性拟合与概率分布。',ARRAY['statistics-lab','probability-lab','data-science','social-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-physics','subject-science','物理学','分析运动、电路、积分和线性模型。',ARRAY['physics-motion','circuit-lab','calculus-lab','matrix-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-chemistry','subject-science','化学','从元素守恒、化学式和浓度单位练习定量化学。',ARRAY['chemistry-balance','chemistry-solution','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-biology','subject-science','生物科学','通过遗传模型、结构知识与实验设计开展学习。',ARRAY['genetics-lab','anatomy-quiz','statistics-lab','psychology-design','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-geography','subject-science','地理科学','用经纬度距离、空间比例和环境模型理解空间问题。',ARRAY['geography-lab','scale-lab','environment-lab','social-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-ecology','subject-science','生态学','联系遗传、环境质量守恒与田间水量。',ARRAY['genetics-lab','environment-lab','agriculture-lab','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-clinical-medicine','subject-medicine','临床医学','使用课程级解剖练习、文献阅读与模拟观察整理知识。',ARRAY['anatomy-quiz','clinical-reading','statistics-lab','pharmacology-units','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-nursing','subject-medicine','护理学','练习解剖基础、观察记录与单位核算，不涉及真实临床处置。',ARRAY['anatomy-quiz','nursing-observation','pharmacology-units','clinical-reading','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-pharmacy','subject-medicine','药学','练习单位量纲、配制数学与化学基础。',ARRAY['pharmacology-units','chemistry-solution','chemistry-balance','clinical-reading','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-public-health','subject-medicine','预防医学与公共卫生','用统计、证据阅读与社会调查理解群体研究。',ARRAY['statistics-lab','probability-lab','clinical-reading','social-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-medical-laboratory','subject-medicine','医学检验技术','结合单位、浓度和数据质量复核实验计算。',ARRAY['pharmacology-units','chemistry-solution','statistics-lab','anatomy-quiz','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-dentistry','subject-medicine','口腔医学','整理结构基础、证据与模拟课程案例。',ARRAY['anatomy-quiz','clinical-reading','nursing-observation','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-rehabilitation','subject-medicine','康复治疗学','以运动测量、结构知识和课程证据练习为主。',ARRAY['anatomy-quiz','sports-analysis','physics-motion','clinical-reading','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-agronomy','subject-agriculture','农学','练习田间水量、遗传与生态数据。',ARRAY['agriculture-lab','genetics-lab','environment-lab','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-horticulture','subject-agriculture','园艺','结合水量管理、遗传和尺度设计形成实验记录。',ARRAY['agriculture-lab','genetics-lab','scale-lab','design-portfolio','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-forestry','subject-agriculture','林学','使用空间测量、生态质量守恒与调查记录。',ARRAY['geography-lab','agriculture-lab','environment-lab','social-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-animal-science','subject-agriculture','动物科学','练习遗传比例、成分数据与实验设计。',ARRAY['genetics-lab','food-science','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-food-science','subject-agriculture','食品科学与工程','练习配料质量、能量核算、浓度与质量管理数据。',ARRAY['food-science','chemistry-solution','statistics-lab','inventory-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-economics','subject-economics','经济学','推导供需均衡、弹性与经营模型。',ARRAY['economics-lab','business-analysis','statistics-lab','finance-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-finance','subject-economics','金融学','练习复利、现金流折现与概率统计。',ARRAY['finance-lab','probability-lab','statistics-lab','economics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-international-trade','subject-economics','国际经济与贸易','结合经营指标、物流、经济模型与语言表达。',ARRAY['economics-lab','business-analysis','inventory-lab','language-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-accounting','subject-management','会计学','练习复式记账、试算平衡与基础财务数学。',ARRAY['accounting-ledger','finance-lab','business-analysis','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-financial-management','subject-management','财务管理','连接现金流、会计、经营指标与库存分析。',ARRAY['finance-lab','accounting-ledger','business-analysis','inventory-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-business-management','subject-management','工商管理','利用项目网络、营销漏斗、成本和研究工作台分析经营。',ARRAY['project-planning','business-analysis','economics-lab','social-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-marketing','subject-management','市场营销','练习转化漏斗、盈亏平衡、媒体核验与调研设计。',ARRAY['business-analysis','media-literacy','social-research','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-logistics','subject-management','物流管理','练习经济订货量、再订货点与关键路径。',ARRAY['inventory-lab','project-planning','business-analysis','geography-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-human-resources','subject-management','人力资源管理','用研究设计、项目与规范论证梳理人力资源议题。',ARRAY['social-research','psychology-design','project-planning','legal-reasoning','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-public-administration','subject-management','公共管理','整理公共议题、证据、利益相关者与项目执行。',ARRAY['social-research','legal-reasoning','project-planning','media-literacy','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-tourism','subject-management','旅游管理','在给定任务资料中设计行程、预算与服务方案。',ARRAY['tourism-planning','geography-lab','business-analysis','language-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-law','subject-law','法学','以事实、争点、规则来源与双方论证构建案例分析。',ARRAY['legal-reasoning','philosophy-argument','writing-studio','social-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-sociology','subject-law','社会学','练习研究问题、抽样、访谈与统计分析。',ARRAY['social-research','statistics-lab','psychology-design','media-literacy','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-social-work','subject-law','社会工作','以虚构案例整理需求、资源与支持计划。',ARRAY['social-research','psychology-design','legal-reasoning','project-planning','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-political-science','subject-law','政治学与行政学','比较来源、分析论证、组织社会研究。',ARRAY['philosophy-argument','social-research','history-research','media-literacy','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-education','subject-education','教育学','组织教学目标、活动、评价与教育研究设计。',ARRAY['education-design','psychology-design','social-research','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-primary-education','subject-education','小学教育','围绕年龄适宜目标设计课堂任务与形成性评价。',ARRAY['education-design','writing-studio','language-lab','design-contrast','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-physical-education','subject-education','体育教育','核算配速、运动表现数据并组织教学。',ARRAY['sports-analysis','education-design','statistics-lab','physics-motion','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-psychology','subject-science','心理学','从变量、对照、混淆因素与统计设计理解研究。',ARRAY['psychology-design','statistics-lab','probability-lab','social-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-chinese-literature','subject-literature','汉语言文学','练习文本细读、证据引用、论证与写作。',ARRAY['literature-reading','writing-studio','philosophy-argument','history-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-english','subject-literature','英语','练习学术词汇、翻译策略与结构化写作。',ARRAY['language-lab','translation-studio','writing-studio','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-translation','subject-literature','翻译','记录源文、译文、术语、目的和修订理由。',ARRAY['translation-studio','language-lab','writing-studio','media-literacy','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-journalism','subject-literature','新闻学','梳理五要素、来源可信性与交叉核验。',ARRAY['media-literacy','writing-studio','social-research','history-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-communications','subject-literature','传播学','结合媒体核验、调查设计与传播指标。',ARRAY['media-literacy','social-research','business-analysis','statistics-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-history','subject-history','历史学','以史料元数据、年代、来源比较和论证构建研究记录。',ARRAY['history-research','literature-reading','philosophy-argument','geography-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-archaeology','subject-history','考古学','练习资料整理、空间比例与来源论证。',ARRAY['history-research','scale-lab','geography-lab','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-philosophy','subject-philosophy','哲学','分解主张、前提、推理、反例与回应。',ARRAY['philosophy-argument','legal-reasoning','literature-reading','writing-studio','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-visual-design','subject-art','视觉传达设计','核对色彩对比、设计目标和作品集中的过程证据。',ARRAY['design-contrast','design-portfolio','architecture-studio','media-literacy','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-industrial-design','subject-art','工业设计','结合尺度、机构基础、设计任务书与作品集。',ARRAY['design-portfolio','scale-lab','mechanics-lab','architecture-studio','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-digital-media','subject-art','数字媒体艺术','在视觉、软件需求、叙事与作品集之间建立联系。',ARRAY['design-contrast','design-portfolio','software-design','writing-studio','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-music','subject-art','音乐学','用十二平均律频率和音程工具学习声音关系。',ARRAY['music-lab','education-design','design-portfolio','history-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-fine-arts','subject-art','美术学','记录作品观察、形式分析、创作过程与修订。',ARRAY['design-portfolio','design-contrast','literature-reading','history-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-defense-education','subject-military','国防教育与军事基础','开展课程级历史、地理和后勤学习，不包含武器与作战操作。',ARRAY['history-research','geography-lab','inventory-lab','project-planning','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-digital-humanities','subject-interdisciplinary','数字人文','连接文本、数据库、统计与来源研究。',ARRAY['literature-reading','sql-lab','data-science','history-research','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-cognitive-science','subject-interdisciplinary','认知科学','组合实验设计、概率、数据与哲学论证。',ARRAY['psychology-design','data-science','probability-lab','philosophy-argument','research-planning','study-notebook'],CURRENT_TIMESTAMP);
INSERT INTO "AcademicsMajor" ("id","subjectId","name","description","moduleIds","updatedAt") VALUES ('major-general','subject-general','自主学习与通识','自由组合学习板块，记录目标、练习与复盘。',ARRAY['writing-studio','statistics-lab','language-lab','study-notebook','research-planning'],CURRENT_TIMESTAMP);
