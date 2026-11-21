#include "whisper.h"

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <iterator>
#include <memory>
#include <string_view>
#include <vector>

// stdin carries validated mono, 16 kHz, little-endian PCM. stdout is UTF-8 text.
int main(int argc, char **argv) {
    const bool check_model = argc == 3 && std::string_view(argv[1]) == "--check-model";
    if (argc != 2 && !check_model) {
        return 2;
    }

    std::vector<float> samples;
    if (!check_model) {
        const std::vector<unsigned char> pcm((std::istreambuf_iterator<char>(std::cin)), {});
        if (pcm.empty() || pcm.size() % 2 != 0) {
            return 2;
        }
        samples.reserve(pcm.size() / 2);
        for (std::size_t i = 0; i < pcm.size(); i += 2) {
            const int value = pcm[i] | (static_cast<int>(pcm[i + 1]) << 8);
            samples.push_back((value < 32768 ? value : value - 65536) / 32768.0f);
        }
        if (std::all_of(samples.begin(), samples.end(), [](float sample) { return sample == 0; })) {
            return 0;
        }
    }

    whisper_log_set([](enum ggml_log_level, const char *, void *) {}, nullptr);
    auto context_params = whisper_context_default_params();
    context_params.use_gpu = !check_model;
    auto *model = whisper_init_from_file_with_params(argv[argc - 1], context_params);
    if (!model && context_params.use_gpu) {
        context_params.use_gpu = false;
        model = whisper_init_from_file_with_params(argv[argc - 1], context_params);
    }
    const std::unique_ptr<whisper_context, decltype(&whisper_free)> context(model, whisper_free);
    if (!context) {
        return 3;
    }
    if (check_model) {
        return 0;
    }

    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.language = "auto";
    params.no_timestamps = true;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    if (whisper_full(context.get(), params, samples.data(), static_cast<int>(samples.size())) != 0) {
        return 4;
    }
    const int segments = whisper_full_n_segments(context.get());
    for (int i = 0; i < segments; ++i) {
        std::cout << whisper_full_get_segment_text(context.get(), i);
    }
    return std::cout ? 0 : 4;
}
