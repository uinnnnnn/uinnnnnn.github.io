AFRAME.registerComponent("gesture-detector", {
    schema: {
      color: { default: "#FF0000" },
    },
  
    init: function () {
      this.el.addEventListener("mouseenter", function () {
        // 当手势进入方块时，增加积分
        incrementScore();
      });
    },
  });