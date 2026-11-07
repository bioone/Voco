"""将 Z-Image-Turbo FP8 权重转换为 diffusers ZImageTransformer2DModel 可分片格式"""

import safetensors.torch
import os
import re

FP8_PATH = r"E:\electron\qwenASR\model\Z-Image-Turbo-FP8\z-image-turbo-fp8-e5m2.safetensors"
OUT_DIR = r"E:\electron\qwenASR\model\Z-Image-Turbo\transformer"
PREFIX = "model.diffusion_model."


def split_qkv(tensor):
    """qkv weight shape [3*dim, dim] -> q,k,v each [dim, dim]"""
    dim = tensor.shape[0] // 3
    t = tensor.contiguous()
    return (
        t[:dim].clone(),
        t[dim:2 * dim].clone(),
        t[2 * dim:].clone(),
    )


def main():
    print(f"Loading FP8 weights from: {FP8_PATH}")
    state_dict = safetensors.torch.load_file(FP8_PATH)
    print(f"Original keys: {len(state_dict)}")

    new_state_dict = {}

    for key, tensor in state_dict.items():
        k = key[len(PREFIX):]

        k = re.sub(r"^final_layer\.adaLN_modulation\.1\.", "all_final_layer.2-1.adaLN_modulation.1.", k)
        k = re.sub(r"^final_layer\.linear\.", "all_final_layer.2-1.linear.", k)
        k = re.sub(r"^x_embedder\.", "all_x_embedder.2-1.", k)

        if ".qkv." in k:
            q, kpart, v = split_qkv(tensor)
            base = k.replace(".qkv.weight", "")
            new_state_dict[base + ".to_q.weight"] = q
            new_state_dict[base + ".to_k.weight"] = kpart
            new_state_dict[base + ".to_v.weight"] = v
        elif ".k_norm." in k:
            new_state_dict[k.replace(".k_norm.", ".norm_k.")] = tensor
        elif ".q_norm." in k:
            new_state_dict[k.replace(".q_norm.", ".norm_q.")] = tensor
        elif ".out." in k:
            new_state_dict[k.replace(".out.", ".to_out.0.")] = tensor
        else:
            new_state_dict[k] = tensor

    print(f"Converted keys: {len(new_state_dict)}")

    out_path = os.path.join(OUT_DIR, "diffusion_pytorch_model.safetensors")
    os.makedirs(OUT_DIR, exist_ok=True)
    safetensors.torch.save_file(new_state_dict, out_path)
    print(f"Saved to: {out_path}")


if __name__ == "__main__":
    main()
