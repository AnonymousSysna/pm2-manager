import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Login from "./Login";

const navigateMock = vi.fn();
const loginMock = vi.fn();
const toastPromiseMock = vi.fn((promise) => promise);

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("../api", () => ({
  auth: {
    login: (username: string, password: string) => loginMock(username, password)
  }
}));

vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: {
    promise: (promise: Promise<unknown>) => toastPromiseMock(promise)
  },
  getErrorMessage: (error, fallback) => error?.message || fallback
}));

describe("Login", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    loginMock.mockReset();
    toastPromiseMock.mockReset();
    toastPromiseMock.mockImplementation((promise) => promise);
  });

  it("submits credentials and redirects on success", async () => {
    loginMock.mockResolvedValue({ success: true, data: { authenticated: true }, error: null });

    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith("admin", "secret");
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
    });
  });
});
