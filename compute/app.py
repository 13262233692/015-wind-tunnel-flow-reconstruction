from flask import Flask, request, jsonify
from flask_cors import CORS
import threading
import time
import json
import uuid
from typing import Dict
from navier_stokes_solver import NavierStokesSolver
from aerodynamics_analyzer import AerodynamicsAnalyzer

app = Flask(__name__)
CORS(app)

solvers: Dict[str, Dict] = {}
_solver_lock = threading.Lock()


def _get_or_create_solver(sim_id: str = None, config: Dict = None):
    global solvers
    with _solver_lock:
        if sim_id and sim_id in solvers:
            return solvers[sim_id]
        sim_id = sim_id or str(uuid.uuid4())[:8]
        if config is None:
            config = {}
        nx = config.get("grid", {}).get("nx", 64)
        ny = config.get("grid", {}).get("ny", 48)
        nz = config.get("grid", {}).get("nz", 16)
        Re = config.get("reynolds", 1000.0)
        dt = config.get("dt", 0.001)
        u_inf = config.get("free_stream", {}).get("u", 1.0)
        v_inf = config.get("free_stream", {}).get("v", 0.0)
        w_inf = config.get("free_stream", {}).get("w", 0.0)
        solver = NavierStokesSolver(nx=nx, ny=ny, nz=nz, reynolds=Re, dt=dt)
        solver.set_free_stream(u_inf=u_inf, v_inf=v_inf, w_inf=w_inf)
        analyzer = AerodynamicsAnalyzer(solver)
        solvers[sim_id] = {
            "id": sim_id,
            "solver": solver,
            "analyzer": analyzer,
            "config": config,
            "created_at": time.time(),
            "steps": 0
        }
        return solvers[sim_id]


@app.route("/api/simulations", methods=["POST"])
def create_simulation():
    data = request.get_json() or {}
    sim = _get_or_create_solver(config=data)
    return jsonify({
        "simulation_id": sim["id"],
        "config": sim["config"],
        "created_at": sim["created_at"]
    }), 201


@app.route("/api/simulations/<sim_id>", methods=["GET"])
def get_simulation(sim_id):
    with _solver_lock:
        if sim_id not in solvers:
            return jsonify({"error": "Simulation not found"}), 404
        sim = solvers[sim_id]
        return jsonify({
            "simulation_id": sim["id"],
            "config": sim["config"],
            "steps": sim["steps"],
            "time": sim["solver"].t,
            "created_at": sim["created_at"]
        })


@app.route("/api/simulations/<sim_id>/step", methods=["POST"])
def step_simulation(sim_id):
    with _solver_lock:
        if sim_id not in solvers:
            return jsonify({"error": "Simulation not found"}), 404
        sim = solvers[sim_id]
    data = request.get_json() or {}
    n_steps = data.get("steps", 1)
    sim["solver"].step(n_steps=n_steps)
    sim["steps"] += n_steps
    state = sim["solver"].get_state()
    return jsonify({
        "simulation_id": sim_id,
        "steps_completed": n_steps,
        "total_steps": sim["steps"],
        "state": state
    })


@app.route("/api/simulations/<sim_id>/state", methods=["GET"])
def get_state(sim_id):
    with _solver_lock:
        if sim_id not in solvers:
            return jsonify({"error": "Simulation not found"}), 404
        sim = solvers[sim_id]
    state = sim["solver"].get_state()
    return jsonify({
        "simulation_id": sim_id,
        "state": state
    })


@app.route("/api/simulations/<sim_id>/slice", methods=["GET"])
def get_slice(sim_id):
    with _solver_lock:
        if sim_id not in solvers:
            return jsonify({"error": "Simulation not found"}), 404
        sim = solvers[sim_id]
    axis = request.args.get("axis", "z")
    index = request.args.get("index", None)
    index = int(index) if index else None
    slice_data = sim["solver"].export_slice(axis=axis, index=index)
    return jsonify({
        "simulation_id": sim_id,
        "slice": slice_data
    })


@app.route("/api/simulations/<sim_id>/aerodynamics", methods=["POST"])
def get_aerodynamics(sim_id):
    with _solver_lock:
        if sim_id not in solvers:
            return jsonify({"error": "Simulation not found"}), 404
        sim = solvers[sim_id]
    data = request.get_json() or {}
    alpha = data.get("alpha", 0.0)
    forces = sim["analyzer"].compute_forces(alpha=alpha)
    surface = sim["analyzer"].compute_surface_pressure(alpha=alpha)
    quality = sim["analyzer"].compute_flow_quality()
    return jsonify({
        "simulation_id": sim_id,
        "alpha": alpha,
        "forces": forces,
        "surface_pressure": surface,
        "flow_quality": quality
    })


@app.route("/api/simulations/<sim_id>/polar", methods=["POST"])
def get_polar_curve(sim_id):
    with _solver_lock:
        if sim_id not in solvers:
            return jsonify({"error": "Simulation not found"}), 404
        sim = solvers[sim_id]
    data = request.get_json() or {}
    alphas = data.get("alphas", None)
    polar = sim["analyzer"].compute_polar_curve(alphas=alphas)
    return jsonify({
        "simulation_id": sim_id,
        "polar_curve": polar
    })


@app.route("/api/simulations/<sim_id>/compare", methods=["POST"])
def compare_simulations(sim_id):
    data = request.get_json() or {}
    compare_ids = data.get("compare_with", [])
    metric = data.get("metric", "CL")
    results = []
    all_ids = [sim_id] + compare_ids
    for sid in all_ids:
        with _solver_lock:
            if sid not in solvers:
                continue
            sim = solvers[sid]
        alpha = data.get("alpha", 0.0)
        forces = sim["analyzer"].compute_forces(alpha=alpha)
        results.append({
            "simulation_id": sid,
            "config": sim["config"],
            "metric_value": forces.get(metric, 0.0),
            "forces": forces
        })
    return jsonify({
        "metric": metric,
        "alpha": data.get("alpha", 0.0),
        "comparisons": results
    })


@app.route("/api/simulations", methods=["GET"])
def list_simulations():
    with _solver_lock:
        return jsonify({
            "simulations": [
                {
                    "id": sid,
                    "steps": s["steps"],
                    "time": s["solver"].t,
                    "created_at": s["created_at"]
                }
                for sid, s in solvers.items()
            ]
        })


@app.route("/api/simulations/<sim_id>/reset", methods=["POST"])
def reset_simulation(sim_id):
    with _solver_lock:
        if sim_id not in solvers:
            return jsonify({"error": "Simulation not found"}), 404
        sim = solvers[sim_id]
        config = sim["config"]
        nx = config.get("grid", {}).get("nx", 64)
        ny = config.get("grid", {}).get("ny", 48)
        nz = config.get("grid", {}).get("nz", 16)
        Re = config.get("reynolds", 1000.0)
        dt = config.get("dt", 0.001)
        u_inf = config.get("free_stream", {}).get("u", 1.0)
        v_inf = config.get("free_stream", {}).get("v", 0.0)
        w_inf = config.get("free_stream", {}).get("w", 0.0)
        sim["solver"] = NavierStokesSolver(nx=nx, ny=ny, nz=nz, reynolds=Re, dt=dt)
        sim["solver"].set_free_stream(u_inf=u_inf, v_inf=v_inf, w_inf=w_inf)
        sim["analyzer"] = AerodynamicsAnalyzer(sim["solver"])
        sim["steps"] = 0
    return jsonify({"simulation_id": sim_id, "status": "reset"})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "cfd-compute",
        "active_simulations": len(solvers),
        "timestamp": time.time()
    })


if __name__ == "__main__":
    print("Starting CFD Compute Service on port 5001...")
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
