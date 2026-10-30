"use client";

import { useState, useCallback } from "react";
import Toast, { type ToastProps } from "./Toast";

type ToastOptions = Omit<ToastProps, "isVisible" | "onClose">;

export function useToast() {
  const [state, setState] = useState<{
    isVisible: boolean;
    options: ToastOptions;
  }>({
    isVisible: false,
    options: {
      message: "",
      variant: "info",
    },
  });

  const showToast = useCallback((options: ToastOptions) => {
    setState({
      isVisible: true,
      options,
    });
  }, []);

  const success = useCallback((message: string) => {
    showToast({ message, variant: "success" });
  }, [showToast]);

  const error = useCallback((message: string) => {
    showToast({ message, variant: "error" });
  }, [showToast]);

  const info = useCallback((message: string) => {
    showToast({ message, variant: "info" });
  }, [showToast]);

  const handleClose = useCallback(() => {
    setState((prev) => ({ ...prev, isVisible: false }));
  }, []);

  const ToastComponent = () => (
    <Toast
      isVisible={state.isVisible}
      message={state.options.message}
      variant={state.options.variant}
      duration={state.options.duration}
      onClose={handleClose}
    />
  );

  return { showToast, success, error, info, Toast: ToastComponent };
}
