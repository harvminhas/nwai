"use client";

import { useState, useCallback } from "react";
import ConfirmDialog, { type ConfirmDialogProps } from "./ConfirmDialog";

type ConfirmOptions = Omit<ConfirmDialogProps, "isOpen" | "onConfirm" | "onCancel">;

export function useConfirm() {
  const [state, setState] = useState<{
    isOpen: boolean;
    resolve: ((value: boolean) => void) | null;
    options: ConfirmOptions;
  }>({
    isOpen: false,
    resolve: null,
    options: {
      title: "",
      message: "",
    },
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        resolve,
        options,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState({ isOpen: false, resolve: null, options: { title: "", message: "" } });
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState({ isOpen: false, resolve: null, options: { title: "", message: "" } });
  }, [state.resolve]);

  const ConfirmDialogComponent = () => (
    <ConfirmDialog
      isOpen={state.isOpen}
      title={state.options.title}
      message={state.options.message}
      confirmLabel={state.options.confirmLabel}
      cancelLabel={state.options.cancelLabel}
      variant={state.options.variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, ConfirmDialog: ConfirmDialogComponent };
}
