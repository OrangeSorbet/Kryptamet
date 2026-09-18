import numpy as np
import tenseal as ts


def _pad(img, pad):
    return np.pad(img, ((pad, pad), (pad, pad)), mode="constant")


def encrypted_conv2d(context, in_channel_images, kernel_weights, bias, stride=1, padding=1):
    out_channels, in_channels, kh, kw = kernel_weights.shape
    padded = [_pad(img, padding) for img in in_channel_images]

    enc_channels = []
    windows_nb = None
    for img in padded:
        enc_x, windows_nb = ts.im2col_encoding(context, img.tolist(), kh, kw, stride)
        enc_channels.append(enc_x)

    out_size = int(round(windows_nb ** 0.5))
    outputs = []
    for oc in range(out_channels):
        enc_sum = None
        for ic in range(in_channels):
            kernel_matrix = kernel_weights[oc, ic].tolist()
            y = enc_channels[ic].conv2d_im2col(kernel_matrix, windows_nb)
            enc_sum = y if enc_sum is None else enc_sum + y
        enc_sum = enc_sum + float(bias[oc])
        decrypted = np.array(enc_sum.decrypt())
        outputs.append(decrypted.reshape(out_size, out_size))
    return outputs


def square(x):
    return x * x


def avgpool2d(x, size=2):
    h, w = x.shape
    return x.reshape(h // size, size, w // size, size).mean(axis=(1, 3))


def encrypted_linear_layer(context, x_flat, weight_matrix, bias):
    enc_x = ts.ckks_vector(context, x_flat.tolist())
    outputs = []
    for j in range(weight_matrix.shape[0]):
        enc_y = (enc_x * weight_matrix[j].tolist()).sum() + float(bias[j])
        outputs.append(enc_y.decrypt()[0])
    return np.array(outputs)


def run_encrypted_cnn(context, image_28x28, state_dict):
    conv1_w = state_dict["conv1.weight"].numpy()
    conv1_b = state_dict["conv1.bias"].numpy()
    conv2_w = state_dict["conv2.weight"].numpy()
    conv2_b = state_dict["conv2.bias"].numpy()
    fc1_w = state_dict["fc1.weight"].numpy()
    fc1_b = state_dict["fc1.bias"].numpy()
    fc2_w = state_dict["fc2.weight"].numpy()
    fc2_b = state_dict["fc2.bias"].numpy()

    conv1_out = encrypted_conv2d(context, [image_28x28], conv1_w, conv1_b, stride=1, padding=1)
    conv1_act = [avgpool2d(square(c), 2) for c in conv1_out]

    conv2_out = encrypted_conv2d(context, conv1_act, conv2_w, conv2_b, stride=1, padding=1)
    conv2_act = [avgpool2d(square(c), 2) for c in conv2_out]

    flat = np.stack(conv2_act).flatten()

    fc1_out = encrypted_linear_layer(context, flat, fc1_w, fc1_b)
    fc1_act = square(fc1_out)

    fc2_out = encrypted_linear_layer(context, fc1_act, fc2_w, fc2_b)
    return fc2_out
