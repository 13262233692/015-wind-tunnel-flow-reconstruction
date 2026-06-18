# 风洞流场重建系统 | Wind Tunnel Flow Reconstruction System

用于风洞实验数据分析与飞行器气动性能优化的流场重建平台。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (Frontend)                       │
│   Three.js + WebGL 3D流场可视化 · Chart.js数据分析           │
│              实时WebSocket数据流渲染                         │
└────────────────────────────┬────────────────────────────────┘
                             │ ws://localhost:8080/api/ws
┌────────────────────────────▼────────────────────────────────┐
│                      中台 (Backend - Go)                     │
│   WebSocket连接管理 · CFD计算调度 · 传感器数据聚合           │
│            多工况实验对比 · 静态资源服务                     │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP REST API
┌────────────────────────────▼────────────────────────────────┐
│                   计算层 (Compute - Python)                  │
│   Navier-Stokes求解器 · NACA翼型气动分析                     │
│            升阻比计算 · 压力分布 · 极曲线生成                 │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
wind-tunnel-flow-reconstruction/
├── compute/              # CFD计算层 (Python + Flask)
│   ├── app.py                      # REST API服务
│   ├── navier_stokes_solver.py     # Navier-Stokes求解器
│   ├── aerodynamics_analyzer.py    # 气动性能分析器
│   └── requirements.txt            # Python依赖
├── backend/              # 数据中台 (Go + Gin + WebSocket)
│   ├── go.mod                      # Go模块定义
│   └── main.go                     # 中台主服务
├── frontend/             # 前端可视化 (Three.js)
│   ├── index.html                  # 主页面
│   ├── styles.css                  # 样式表
│   └── app.js                      # 3D渲染+交互逻辑
├── start.bat             # Windows一键启动脚本
├── start.ps1             # PowerShell启动脚本
└── README.md
```

## 核心功能

### 1. 风洞流场实时重建
- 基于投影法的Navier-Stokes方程求解器
- 3D交错网格有限差分方法
- 压力泊松方程迭代求解
- 可配置网格分辨率、雷诺数、时间步长

### 2. 气动压力分布可视化
- NACA系列翼型表面压力系数(Cp)计算
- 上/下表面压力分布曲线
- 多种3D可视化模式:
  - **体渲染**: 速度/涡量/压力场三维点云
  - **切面分析**: X/Y/Z轴任意切面伪彩色图
  - **流线追踪**: 流体质点轨迹可视化
  - **涡量显示**: Q准则涡结构识别

### 3. 飞行器升阻比分析
- 升力系数 CL · 阻力系数 CD · 力矩系数 Cm
- L/D升阻比实时计算
- CL-α, CD-α, L/D-α特性曲线
- CL-CD极曲线
- 失速迎角识别与最大升阻比点

### 4. 多工况实验对比
- 多仿真实例并行管理
- 指定指标(CL/CD/LD/Cm)横向对比
- 柱状图可视化对比结果

### 5. 实时数据采集同步
- WebSocket双向实时通信
- 8通道传感器数据模拟
- Pitot管·静压·热线风速仪·温度·应变天平
- 传感器时序图表

## 快速启动

### 方式一: PowerShell (推荐)
```powershell
# 在项目根目录执行
powershell -ExecutionPolicy Bypass -File start.ps1
```

### 方式二: 批处理
双击 `start.bat`

### 方式三: 手动启动

**步骤1 - 启动计算层**
```bash
cd compute
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
# 监听端口: 5000
```

**步骤2 - 启动中台**
```bash
cd backend
go mod tidy
go run main.go
# 监听端口: 8080
```

**步骤3 - 访问前端**
打开浏览器访问: `http://localhost:8080/`

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端可视化 | Three.js r160 | WebGL 3D渲染引擎 |
|  | OrbitControls | 轨迹球交互控制 |
|  | Chart.js 4.x | 2D数据图表 |
|  | Import Maps | ES模块加载 |
| 中台服务 | Go 1.21+ | 高性能并发 |
|  | Gin v1.9 | HTTP框架 |
|  | Gorilla WebSocket | WebSocket协议 |
| 计算层 | Python 3.9+ | 科学计算 |
|  | NumPy | 数值线性代数 |
|  | Flask 2.3 | REST微服务 |
|  | 投影法 | NS方程数值解法 |

## 使用流程

1. **配置参数**: 设置雷诺数、来流速度、网格尺寸、迎角
2. **创建仿真**: 点击"创建仿真"生成计算实例
3. **计算求解**: 单步步进或开启"实时流"模式自动计算
4. **查看结果**: 切换可视化模式、调整切面和色映射
5. **气动分析**: 分析当前迎角气动力/生成完整极曲线
6. **对比实验**: 创建多组仿真后选择对比指标
7. **数据导出**: 一键导出JSON或截图3D视图

## CFD求解器说明

采用基于交错网格的**投影法(Projection Method)**求解不可压缩Navier-Stokes方程:

```
预测步: u* = u + dt·(-u·∇u + ν·∇²u)
修正步: ∇²p = (ρ/dt)·∇·u*
更新步: u = u* - (dt/ρ)·∇p
```

- 对流项: 中心差分格式
- 扩散项: 二阶Laplacian
- 压力泊松: Jacobi迭代(50步)
- 边界条件: 进口Dirichlet, 出口Neumann, 固壁无滑移

## 端口分配

| 服务 | 端口 | 协议 |
|------|------|------|
| CFD计算API | 5000 | HTTP/REST |
| Go中台 | 8080 | HTTP/WS |
| 前端静态资源 | 8080 | HTTP |
| WebSocket | 8080 | WS |

## WebSocket消息协议

| 消息类型(type) | 方向 | 说明 |
|---------------|------|------|
| create_simulation | C→S | 创建仿真实例 |
| step_simulation | C→S | 执行N步计算 |
| start_stream | C→S | 开启自动计算流 |
| stop_stream | C→S | 停止自动计算 |
| get_aerodynamics | C→S | 获取气动参数 |
| get_polar | C→S | 生成极曲线 |
| sensor_data | C→S | 上传传感器读数 |
| state_updated | S→C | 计算完成状态更新 |
| stream_data | S→C | 实时流数据推送 |
| aerodynamics_data | S→C | 气动分析结果 |
| polar_data | S→C | 极曲线数据 |
| sensor_data_broadcast | S→C | 传感器广播 |
