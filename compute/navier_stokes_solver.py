import numpy as np
from typing import Tuple, Dict, Optional
import json


class NavierStokesSolver:
    def __init__(self, nx: int = 128, ny: int = 64, nz: int = 32,
                 reynolds: float = 1000.0, dt: float = 0.001):
        self.nx = nx
        self.ny = ny
        self.nz = nz
        self.Re = reynolds
        self.dt = dt
        self.dx = 1.0 / (nx - 1)
        self.dy = 1.0 / (ny - 1)
        self.dz = 1.0 / (nz - 1)
        self.nu = 1.0 / reynolds
        self._initialize_fields()

    def _initialize_fields(self):
        shape = (self.nz, self.ny, self.nx)
        self.u = np.zeros(shape)
        self.v = np.zeros(shape)
        self.w = np.zeros(shape)
        self.p = np.zeros(shape)
        self.rho = np.ones(shape) * 1.225
        self.t = 0.0

    def set_free_stream(self, u_inf: float = 1.0, v_inf: float = 0.0, w_inf: float = 0.0):
        self.u[:, :, 0] = u_inf
        self.v[:, :, 0] = v_inf
        self.w[:, :, 0] = w_inf
        self.u[:, :, -1] = u_inf
        self.v[:, :, -1] = v_inf
        self.w[:, :, -1] = w_inf

    def _laplacian(self, f: np.ndarray) -> np.ndarray:
        lap = np.zeros_like(f)
        lap[1:-1, 1:-1, 1:-1] = (
            (f[1:-1, 1:-1, 2:] - 2 * f[1:-1, 1:-1, 1:-1] + f[1:-1, 1:-1, :-2]) / self.dx**2 +
            (f[1:-1, 2:, 1:-1] - 2 * f[1:-1, 1:-1, 1:-1] + f[1:-1, :-2, 1:-1]) / self.dy**2 +
            (f[2:, 1:-1, 1:-1] - 2 * f[1:-1, 1:-1, 1:-1] + f[:-2, 1:-1, 1:-1]) / self.dz**2
        )
        return lap

    def _gradient(self, f: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        dfdx = np.zeros_like(f)
        dfdy = np.zeros_like(f)
        dfdz = np.zeros_like(f)
        dfdx[1:-1, 1:-1, 1:-1] = (f[1:-1, 1:-1, 2:] - f[1:-1, 1:-1, :-2]) / (2 * self.dx)
        dfdy[1:-1, 1:-1, 1:-1] = (f[1:-1, 2:, 1:-1] - f[1:-1, :-2, 1:-1]) / (2 * self.dy)
        dfdz[1:-1, 1:-1, 1:-1] = (f[2:, 1:-1, 1:-1] - f[:-2, 1:-1, 1:-1]) / (2 * self.dz)
        return dfdx, dfdy, dfdz

    def _divergence(self, u: np.ndarray, v: np.ndarray, w: np.ndarray) -> np.ndarray:
        dudx, _, _ = self._gradient(u)
        _, dvdy, _ = self._gradient(v)
        _, _, dwdz = self._gradient(w)
        return dudx + dvdy + dwdz

    def _advection(self, f: np.ndarray, u: np.ndarray, v: np.ndarray, w: np.ndarray) -> np.ndarray:
        dfdx, dfdy, dfdz = self._gradient(f)
        return u * dfdx + v * dfdy + w * dfdz

    def _solve_pressure_poisson(self, rhs: np.ndarray, max_iter: int = 50) -> np.ndarray:
        p = np.copy(self.p)
        factor = 1.0 / (2.0 / self.dx**2 + 2.0 / self.dy**2 + 2.0 / self.dz**2)
        for _ in range(max_iter):
            p_new = np.copy(p)
            p_new[1:-1, 1:-1, 1:-1] = factor * (
                (p[1:-1, 1:-1, 2:] + p[1:-1, 1:-1, :-2]) / self.dx**2 +
                (p[1:-1, 2:, 1:-1] + p[1:-1, :-2, 1:-1]) / self.dy**2 +
                (p[2:, 1:-1, 1:-1] + p[:-2, 1:-1, 1:-1]) / self.dz**2 -
                rhs[1:-1, 1:-1, 1:-1]
            )
            p_new[:, :, 0] = p_new[:, :, 1]
            p_new[:, :, -1] = 0.0
            p_new[:, 0, :] = p_new[:, 1, :]
            p_new[:, -1, :] = p_new[:, -2, :]
            p_new[0, :, :] = p_new[1, :, :]
            p_new[-1, :, :] = p_new[-2, :, :]
            p = p_new
        return p

    def step(self, n_steps: int = 1) -> Dict:
        for _ in range(n_steps):
            u_star = self.u + self.dt * (
                -self._advection(self.u, self.u, self.v, self.w) +
                self.nu * self._laplacian(self.u)
            )
            v_star = self.v + self.dt * (
                -self._advection(self.v, self.u, self.v, self.w) +
                self.nu * self._laplacian(self.v)
            )
            w_star = self.w + self.dt * (
                -self._advection(self.w, self.u, self.v, self.w) +
                self.nu * self._laplacian(self.w)
            )
            div_star = self._divergence(u_star, v_star, w_star)
            rhs = div_star / self.dt
            self.p = self._solve_pressure_poisson(rhs)
            dpdx, dpdy, dpdz = self._gradient(self.p)
            self.u[1:-1, 1:-1, 1:-1] = u_star[1:-1, 1:-1, 1:-1] - self.dt * dpdx[1:-1, 1:-1, 1:-1] / self.rho[1:-1, 1:-1, 1:-1]
            self.v[1:-1, 1:-1, 1:-1] = v_star[1:-1, 1:-1, 1:-1] - self.dt * dpdy[1:-1, 1:-1, 1:-1] / self.rho[1:-1, 1:-1, 1:-1]
            self.w[1:-1, 1:-1, 1:-1] = w_star[1:-1, 1:-1, 1:-1] - self.dt * dpdz[1:-1, 1:-1, 1:-1] / self.rho[1:-1, 1:-1, 1:-1]
            self._enforce_boundary_conditions()
            self.t += self.dt
        return self.get_state()

    def _enforce_boundary_conditions(self):
        self.u[:, :, 0] = self.u[:, :, 1]
        self.v[:, :, 0] = self.v[:, :, 1]
        self.w[:, :, 0] = self.w[:, :, 1]
        self.u[:, :, -1] = self.u[:, :, -2]
        self.v[:, :, -1] = self.v[:, :, -2]
        self.w[:, :, -1] = self.w[:, :, -2]
        self.u[:, 0, :] = 0.0
        self.v[:, 0, :] = 0.0
        self.w[:, 0, :] = 0.0
        self.u[:, -1, :] = 0.0
        self.v[:, -1, :] = 0.0
        self.w[:, -1, :] = 0.0
        self.u[0, :, :] = 0.0
        self.v[0, :, :] = 0.0
        self.w[0, :, :] = 0.0
        self.u[-1, :, :] = 0.0
        self.v[-1, :, :] = 0.0
        self.w[-1, :, :] = 0.0

    def get_state(self) -> Dict:
        velocity_magnitude = np.sqrt(self.u**2 + self.v**2 + self.w**2)
        vorticity = self._compute_vorticity()
        vorticity_magnitude = np.sqrt(vorticity[0]**2 + vorticity[1]**2 + vorticity[2]**2)
        return {
            "time": self.t,
            "time_step": self.dt,
            "reynolds": self.Re,
            "grid": {"nx": self.nx, "ny": self.ny, "nz": self.nz},
            "velocity": {
                "u": self._downsample(self.u).tolist(),
                "v": self._downsample(self.v).tolist(),
                "w": self._downsample(self.w).tolist(),
                "magnitude": self._downsample(velocity_magnitude).tolist()
            },
            "pressure": self._downsample(self.p).tolist(),
            "density": self._downsample(self.rho).tolist(),
            "vorticity": {
                "x": self._downsample(vorticity[0]).tolist(),
                "y": self._downsample(vorticity[1]).tolist(),
                "z": self._downsample(vorticity[2]).tolist(),
                "magnitude": self._downsample(vorticity_magnitude).tolist()
            }
        }

    def _compute_vorticity(self) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        dwdx, dwdy, dwdz = self._gradient(self.w)
        dvdx, dvdy, dvdz = self._gradient(self.v)
        dudx, dudy, dudz = self._gradient(self.u)
        vorticity_x = dwdy - dvdz
        vorticity_y = dudz - dwdx
        vorticity_z = dvdx - dudy
        return vorticity_x, vorticity_y, vorticity_z

    def _downsample(self, arr: np.ndarray, factor: int = 4) -> np.ndarray:
        if arr.ndim == 3:
            return arr[::factor, ::factor, ::factor]
        return arr

    def export_slice(self, axis: str = 'z', index: Optional[int] = None) -> Dict:
        if axis == 'z':
            idx = index if index is not None else self.nz // 2
            return {
                "axis": "z",
                "index": idx,
                "u": self.u[idx, :, :].tolist(),
                "v": self.v[idx, :, :].tolist(),
                "w": self.w[idx, :, :].tolist(),
                "p": self.p[idx, :, :].tolist(),
                "magnitude": np.sqrt(self.u[idx]**2 + self.v[idx]**2 + self.w[idx]**2).tolist()
            }
        elif axis == 'y':
            idx = index if index is not None else self.ny // 2
            return {
                "axis": "y",
                "index": idx,
                "u": self.u[:, idx, :].tolist(),
                "v": self.v[:, idx, :].tolist(),
                "w": self.w[:, idx, :].tolist(),
                "p": self.p[:, idx, :].tolist(),
                "magnitude": np.sqrt(self.u[:, idx]**2 + self.v[:, idx]**2 + self.w[:, idx]**2).tolist()
            }
        else:
            idx = index if index is not None else self.nx // 2
            return {
                "axis": "x",
                "index": idx,
                "u": self.u[:, :, idx].tolist(),
                "v": self.v[:, :, idx].tolist(),
                "w": self.w[:, :, idx].tolist(),
                "p": self.p[:, :, idx].tolist(),
                "magnitude": np.sqrt(self.u[:, :, idx]**2 + self.v[:, :, idx]**2 + self.w[:, :, idx]**2).tolist()
            }
