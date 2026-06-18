import numpy as np
from typing import Dict, List, Tuple
import json


class AerodynamicsAnalyzer:
    def __init__(self, solver):
        self.solver = solver
        self.airfoil_profile = self._generate_naca_profile()

    def _generate_naca_profile(self, naca: str = "0012", n_points: int = 100) -> Tuple[np.ndarray, np.ndarray]:
        m = int(naca[0]) / 100.0
        p = int(naca[1]) / 10.0
        t = int(naca[2:]) / 100.0
        x = np.linspace(0, 1, n_points)
        yt = 5 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 +
                       0.2843 * x**3 - 0.1015 * x**4)
        if p == 0:
            yc = np.zeros_like(x)
            dyc_dx = np.zeros_like(x)
        else:
            yc = np.where(x < p,
                          m / p**2 * (2 * p * x - x**2),
                          m / (1 - p)**2 * ((1 - 2 * p) + 2 * p * x - x**2))
            dyc_dx = np.where(x < p,
                              2 * m / p**2 * (p - x),
                              2 * m / (1 - p)**2 * (p - x))
        theta = np.arctan(dyc_dx)
        xu = x - yt * np.sin(theta)
        yu = yc + yt * np.cos(theta)
        xl = x + yt * np.sin(theta)
        yl = yc - yt * np.cos(theta)
        x_full = np.concatenate([xu[::-1], xl[1:]])
        y_full = np.concatenate([yu[::-1], yl[1:]])
        return x_full, y_full

    def compute_surface_pressure(self, alpha: float = 0.0) -> Dict:
        x_profile, y_profile = self.airfoil_profile
        center_x = self.solver.nx // 2
        center_y = self.solver.ny // 2
        scale = min(self.solver.nx, self.solver.ny) * 0.3
        alpha_rad = np.radians(alpha)
        cos_a, sin_a = np.cos(alpha_rad), np.sin(alpha_rad)
        pressures = []
        x_rot = x_profile * cos_a - y_profile * sin_a
        y_rot = x_profile * sin_a + y_profile * cos_a
        x_grid = (x_rot * scale + center_x).astype(int)
        y_grid = (y_rot * scale + center_y).astype(int)
        x_grid = np.clip(x_grid, 1, self.solver.nx - 2)
        y_grid = np.clip(y_grid, 1, self.solver.ny - 2)
        z_mid = self.solver.nz // 2
        for i in range(len(x_grid)):
            xi, yi = x_grid[i], y_grid[i]
            pressures.append({
                "x": float(x_profile[i]),
                "y": float(y_profile[i]),
                "x_world": float(x_rot[i]),
                "y_world": float(y_rot[i]),
                "pressure": float(self.solver.p[z_mid, yi, xi]),
                "cp": self._compute_cp(float(self.solver.p[z_mid, yi, xi]))
            })
        return {
            "alpha": alpha,
            "profile": "NACA0012",
            "surface_points": pressures
        }

    def _compute_cp(self, p: float, p_inf: float = 0.0, rho_inf: float = 1.225, u_inf: float = 1.0) -> float:
        q_inf = 0.5 * rho_inf * u_inf**2
        return (p - p_inf) / q_inf if q_inf != 0 else 0.0

    def compute_forces(self, alpha: float = 0.0) -> Dict:
        surface_data = self.compute_surface_pressure(alpha)
        points = surface_data["surface_points"]
        n = len(points)
        lift = 0.0
        drag = 0.0
        moment = 0.0
        alpha_rad = np.radians(alpha)
        cos_a, sin_a = np.cos(alpha_rad), np.sin(alpha_rad)
        for i in range(n):
            p1 = points[i]
            p2 = points[(i + 1) % n]
            dx = p2["x_world"] - p1["x_world"]
            dy = p2["y_world"] - p1["y_world"]
            ds = np.sqrt(dx**2 + dy**2)
            if ds == 0:
                continue
            nx = -dy / ds
            ny = dx / ds
            p_avg = 0.5 * (p1["pressure"] + p2["pressure"])
            fx = -p_avg * nx * ds
            fy = -p_avg * ny * ds
            lift += -fx * sin_a + fy * cos_a
            drag += fx * cos_a + fy * sin_a
            x_c = 0.5 * (p1["x_world"] + p2["x_world"])
            y_c = 0.5 * (p1["y_world"] + p2["y_world"])
            moment += x_c * (-p_avg * ny * ds) - y_c * (-p_avg * nx * ds)
        q_ref = 0.5 * 1.225 * 1.0**2
        S_ref = 1.0
        c_ref = 1.0
        CL = lift / (q_ref * S_ref) if q_ref * S_ref != 0 else 0.0
        CD = drag / (q_ref * S_ref) if q_ref * S_ref != 0 else 0.0
        CM = moment / (q_ref * S_ref * c_ref) if q_ref * S_ref * c_ref != 0 else 0.0
        LD_ratio = CL / CD if CD != 0 else float('inf')
        return {
            "alpha": alpha,
            "lift": float(lift),
            "drag": float(drag),
            "moment": float(moment),
            "CL": float(CL),
            "CD": float(CD),
            "CM": float(CM),
            "L_D_ratio": float(LD_ratio) if np.isfinite(LD_ratio) else 999.9
        }

    def compute_polar_curve(self, alphas: List[float] = None) -> Dict:
        if alphas is None:
            alphas = list(range(-10, 21, 2))
        results = []
        for alpha in alphas:
            forces = self.compute_forces(alpha)
            results.append(forces)
        CLs = [r["CL"] for r in results]
        CDs = [r["CD"] for r in results]
        LDs = [r["L_D_ratio"] for r in results]
        stall_idx = int(np.argmax(CLs))
        return {
            "alphas": alphas,
            "CL": CLs,
            "CD": CDs,
            "L_D_ratio": LDs,
            "CL_alpha": list(alphas),
            "CD_alpha": list(alphas),
            "LD_alpha": list(alphas),
            "stall_angle": alphas[stall_idx],
            "max_CL": max(CLs),
            "max_LD": max(LDs),
            "LD_max_alpha": alphas[int(np.argmax(LDs))],
            "detailed": results
        }

    def compute_flow_quality(self) -> Dict:
        u = self.solver.u
        v = self.solver.v
        w = self.solver.w
        p = self.solver.p
        u_avg = np.mean(u)
        v_avg = np.mean(v)
        w_avg = np.mean(w)
        u_rms = np.sqrt(np.mean((u - u_avg)**2))
        v_rms = np.sqrt(np.mean((v - v_avg)**2))
        w_rms = np.sqrt(np.mean((w - w_avg)**2))
        vel_mag = np.sqrt(u**2 + v**2 + w**2)
        turbulence_intensity = (np.sqrt((u_rms**2 + v_rms**2 + w_rms**2) / 3) /
                                (np.mean(vel_mag) + 1e-10)) * 100
        p_std = np.std(p)
        p_mean = np.mean(p)
        pressure_uniformity = (1.0 - p_std / (abs(p_mean) + 1e-10)) * 100
        div_u = self.solver._divergence(u, v, w)
        mass_conservation_error = np.max(np.abs(div_u))
        return {
            "mean_velocity": {
                "u": float(u_avg),
                "v": float(v_avg),
                "w": float(w_avg),
                "magnitude": float(np.mean(vel_mag))
            },
            "rms_velocity": {
                "u": float(u_rms),
                "v": float(v_rms),
                "w": float(w_rms)
            },
            "turbulence_intensity_percent": float(turbulence_intensity),
            "pressure_uniformity_percent": float(max(0, pressure_uniformity)),
            "mass_conservation_error": float(mass_conservation_error),
            "reynolds_number": float(self.solver.Re),
            "mach_number": float(np.mean(vel_mag) / 340.0)
        }
