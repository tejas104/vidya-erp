"use client";
import type { InputHTMLAttributes } from "react";
import { Input } from "../Input/Input";

export function DatePicker(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; hint?: string; error?: string },
) {
  return <Input type="date" {...props} />;
}
