import opensoundscape as opso
from lightweight_server import process_single_clip

clip_data = {'file_path':opso.birds_path,'start_time':0,'end_time':3}
settings = {'spectrogram_colormap':'viridis'}
data=process_single_clip(clip_data, settings)

# plot
import matplotlib.pyplot as plt
plt.imshow(data['spectrogram'])
